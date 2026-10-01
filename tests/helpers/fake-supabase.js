// A small in-memory stand-in for the Supabase client, covering exactly the query shapes this codebase uses.
// Test/dev use only (never imported by the app). Supports: select / insert / update / delete / upsert(ignoreDuplicates),
// eq neq in gt gte lt lte is or order limit maybeSingle single, the nested join  availability:availability_id(...),
// the unique rules of availability and availability_blocks, and "missing table" simulation (migration not run).
const crypto = require('crypto');

function createFakeDb(seed = {}) {
  const tables = { availability: [], availability_blocks: [], admin_actions: [], bookings: [], ...seed };
  const missing = new Set();
  const log = { queries: 0, writes: [] };

  // column defaults the real tables have
  const DEFAULTS = { availability: { booked: false, locked_until: null, locked_by: null }, availability_blocks: { start_time: null, reason: null }, bookings: { status: 'pending' } };
  const mk = (t, p) => ({ id: crypto.randomUUID(), created_at: new Date().toISOString(), ...(DEFAULTS[t] || {}), ...p });

  const missingErr = (t) => ({ code: 'PGRST205', message: `Could not find the table 'public.${t}' in the schema cache` });
  const val = (v) => (v === 'null' ? null : v);

  function conflicts(table, row, rows) {
    if (table === 'availability') return rows.some((r) => r.date === row.date && r.start_time === row.start_time);
    if (table === 'availability_blocks') {
      return rows.some((r) => r.date === row.date && (row.start_time == null ? r.start_time == null : r.start_time === row.start_time));
    }
    return false;
  }

  function parseOr(str) {
    const conds = str.split(',').map((c) => { const m = c.match(/^([^.]+)\.([^.]+)\.(.*)$/); return { col: m[1], op: m[2], v: m[3] }; });
    return (row) => conds.some(({ col, op, v }) => {
      const x = row[col];
      if (op === 'is') return v === 'null' ? x == null : x != null;
      if (op === 'eq') return String(x) === v;
      if (op === 'lt') return x != null && x < v;
      if (op === 'gt') return x != null && x > v;
      throw new Error('fake: unsupported or() op ' + op);
    });
  }

  class Q {
    constructor(table) { this.table = table; this.op = 'select'; this.filters = []; this.orders = []; this.lim = null; this.mode = 'many'; this.returning = false; this.selectArg = ''; }
    select(cols) { if (this.op === 'select') this.selectArg = cols || ''; else { this.returning = true; this.selectArg = cols || ''; } return this; }
    insert(rows) { this.op = 'insert'; this.payload = rows; return this; }
    upsert(rows, opts) { this.op = 'upsert'; this.payload = rows; this.opts = opts || {}; return this; }
    update(p) { this.op = 'update'; this.payload = p; return this; }
    delete() { this.op = 'delete'; return this; }
    eq(c, v) { this.filters.push((r) => r[c] === v); return this; }
    neq(c, v) { this.filters.push((r) => r[c] !== v); return this; }
    in(c, vs) { this.filters.push((r) => vs.includes(r[c])); return this; }
    gt(c, v) { this.filters.push((r) => r[c] != null && r[c] > v); return this; }
    gte(c, v) { this.filters.push((r) => r[c] != null && r[c] >= v); return this; }
    lt(c, v) { this.filters.push((r) => r[c] != null && r[c] < v); return this; }
    lte(c, v) { this.filters.push((r) => r[c] != null && r[c] <= v); return this; }
    is(c, v) { this.filters.push((r) => (v === null ? r[c] == null : r[c] === v)); return this; }
    not(c, op, v) { this.filters.push((r) => (op === 'is' && val(v) === null ? r[c] != null : true)); return this; }
    or(s) { this.filters.push(parseOr(s)); return this; }
    order(c, o) { this.orders.push({ c, asc: !o || o.ascending !== false }); return this; }
    limit(n) { this.lim = n; return this; }
    maybeSingle() { this.mode = 'maybe'; return this; }
    single() { this.mode = 'single'; return this; }
    then(res, rej) { return Promise.resolve().then(() => this.run()).then(res, rej); }

    run() {
      log.queries++;
      const t = this.table;
      if (missing.has(t)) return { data: null, error: missingErr(t) };
      const rows = tables[t] || (tables[t] = []);
      const done = (data) => {
        if (this.mode === 'maybe') return { data: Array.isArray(data) ? (data[0] || null) : data, error: null };
        if (this.mode === 'single') return Array.isArray(data) && data.length ? { data: data[0], error: null } : { data: null, error: { code: 'PGRST116', message: 'no rows' } };
        return { data, error: null };
      };
      const match = (r) => this.filters.every((f) => f(r));
      const withJoin = (r) => {
        if (!/availability:availability_id/.test(this.selectArg)) return { ...r };
        const a = tables.availability.find((x) => x.id === r.availability_id);
        return { ...r, availability: a ? { date: a.date, start_time: a.start_time } : null };
      };

      if (this.op === 'select') {
        let out = rows.filter(match).map(withJoin);
        for (const o of [...this.orders].reverse()) out.sort((a, b) => (a[o.c] < b[o.c] ? -1 : a[o.c] > b[o.c] ? 1 : 0) * (o.asc ? 1 : -1));
        if (this.lim != null) out = out.slice(0, this.lim);
        return done(out);
      }
      if (this.op === 'insert' || this.op === 'upsert') {
        const list = Array.isArray(this.payload) ? this.payload : [this.payload];
        const made = [];
        if (this.op === 'insert') { // all-or-nothing, like a single INSERT statement
          const stage = [...rows];
          for (const p of list) {
            const row = mk(t, p);
            if (conflicts(t, row, stage)) return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
            stage.push(row); made.push(row);
          }
          rows.push(...made);
        } else {
          for (const p of list) {
            const row = mk(t, p);
            if (conflicts(t, row, rows)) { if (this.opts.ignoreDuplicates) continue; }
            rows.push(row); made.push(row);
          }
        }
        made.forEach((r) => log.writes.push({ table: t, op: this.op, row: r }));
        return done(this.returning ? made.map((r) => ({ ...r })) : null);
      }
      if (this.op === 'update') {
        const hit = rows.filter(match);
        hit.forEach((r) => { Object.assign(r, this.payload); log.writes.push({ table: t, op: 'update', row: r }); });
        return done(this.returning ? hit.map((r) => ({ ...r })) : null);
      }
      if (this.op === 'delete') {
        const hit = rows.filter(match);
        tables[t] = rows.filter((r) => !hit.includes(r));
        hit.forEach((r) => log.writes.push({ table: t, op: 'delete', row: r }));
        return done(this.returning ? hit : null);
      }
      throw new Error('fake: unsupported op ' + this.op);
    }
  }

  return {
    tables, log,
    client: { from: (t) => new Q(t) },
    dropTable: (t) => missing.add(t),
    restoreTable: (t) => missing.delete(t),
    count: (t) => (tables[t] || []).length,
  };
}

module.exports = { createFakeDb };
