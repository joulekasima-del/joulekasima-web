/*
  Admin "blocked times" routes (the first admin feature that WRITES). Called from lib/admin.js AFTER it has
  verified the signed session cookie and, for writes, the same-origin check. Each function returns
  { status, body } so it can be tested without HTTP.

  Conservative by design:
  - nothing is written unless validation passes (strict dates/times, max 120 days, no past dates, bounded window)
  - a block never changes a booking or an availability row
  - if the block would affect existing confirmed bookings or active holds, the write is refused until the caller
    explicitly acknowledges them (acknowledgeAffected: true) - the admin page shows them first via /block-preview
  - every change is logged to admin_actions (the write is refused if the log table is missing)
  - if the tables don't exist yet, every route answers 503 + code MIGRATION_REQUIRED and touches nothing
*/
const Tz = require('../assets/timezone');
const B = require('./blocks');

const MIGRATION_MESSAGE = 'Blocked times need a one-time database setup. Run supabase/migrations/0005_admin_blocks.sql in the Supabase SQL editor, then reload this page.';
const migrationRequired = () => ({ status: 503, body: { error: MIGRATION_MESSAGE, code: 'MIGRATION_REQUIRED' } });
const bad = (error) => ({ status: 400, body: { error } });
const hhmm = (t) => (t == null ? null : B.normTime(t).slice(0, 5));

const todayChiangMai = (now) => Tz.localDate(now, Tz.SOURCE_TZ);

// ctx: { supabase, now: Date, slotTimes: ['09:00:00', ...], windowEnd: 'YYYY-MM-DD' }
const validationCtx = (ctx) => ({ today: todayChiangMai(ctx.now), windowEnd: ctx.windowEnd, slotTimes: ctx.slotTimes });

// Is the table there? null = yes, otherwise the "run migration" response. Any other error is thrown (-> 500).
async function tableMissing(supabase, table) {
  const { error } = await supabase.from(table).select('id').limit(1);
  if (!error) return false;
  if (B.isMissingTable(error)) return true;
  throw error;
}
async function checkTables(ctx, { needLog }) {
  if (await tableMissing(ctx.supabase, 'availability_blocks')) return migrationRequired();
  if (needLog && (await tableMissing(ctx.supabase, 'admin_actions'))) return migrationRequired();
  return null;
}

async function logAction(ctx, action, payload) {
  const { error } = await ctx.supabase.from('admin_actions').insert({ action, payload });
  if (error) { console.error('admin_actions log failed:', error.code || '', error.message); return false; }
  return true;
}

const shapeBlock = (b) => ({ id: b.id, date: b.date, startTime: hhmm(b.start_time), reason: b.reason || null, createdAt: b.created_at });

// ---------- GET: list ----------
async function list(ctx) {
  const missing = await checkTables(ctx, { needLog: false });
  if (missing) return missing;
  const today = todayChiangMai(ctx.now);
  const { data, error } = await ctx.supabase.from('availability_blocks').select('id, date, start_time, reason, created_at').gte('date', today).order('date').order('start_time').limit(2000);
  if (error) throw error;
  return { status: 200, body: {
    blocks: (data || []).map(shapeBlock),
    slotTimes: ctx.slotTimes.map(hhmm),
    today,
    windowEnd: ctx.windowEnd,
    maxDate: B.addDays(ctx.windowEnd, B.WINDOW_MARGIN_DAYS),
    maxRangeDays: B.MAX_RANGE_DAYS,
  } };
}

// Existing confirmed bookings and active holds that fall on the rows a block would close. Reads only.
async function findAffected(ctx, value, wanted) {
  const covers = (date, time) => B.isBlocked(wanted, date, time);
  const nowISO = ctx.now.toISOString();

  const avail = await ctx.supabase.from('availability').select('date, start_time, booked, locked_until').gte('date', value.from).lte('date', value.to);
  if (avail.error) throw avail.error;
  const holds = (avail.data || [])
    .filter((r) => !r.booked && r.locked_until && r.locked_until > nowISO && covers(r.date, r.start_time))
    .map((r) => ({ date: r.date, time: hhmm(r.start_time), lockedUntil: r.locked_until }));

  const bk = await ctx.supabase.from('bookings').select('reference, first_name, last_name, email, status, availability:availability_id(date, start_time)').eq('status', 'confirmed').limit(5000);
  if (bk.error) throw bk.error;
  const bookings = (bk.data || [])
    .filter((b) => b.availability && b.availability.date >= value.from && b.availability.date <= value.to && covers(b.availability.date, b.availability.start_time))
    .map((b) => ({ reference: b.reference, name: `${b.first_name || ''} ${b.last_name || ''}`.trim(), email: b.email, date: b.availability.date, time: hhmm(b.availability.start_time) }))
    .sort((x, y) => (x.date + x.time).localeCompare(y.date + y.time));
  return { bookings, holds };
}

async function plan(ctx, body) {
  const v = B.validateBlockRequest(body, validationCtx(ctx));
  if (!v.ok) return { error: bad(v.error) };
  const value = v.value;
  const wanted = B.expandBlocks(value);
  const existing = await B.loadBlocks(ctx.supabase, value.from, value.to);
  const p = B.planInsert(existing, wanted);
  return { value, wanted, plan: p };
}

// ---------- POST block-preview: what would this do? (changes nothing) ----------
async function preview(ctx, body) {
  const missing = await checkTables(ctx, { needLog: false });
  if (missing) return missing;
  const r = await plan(ctx, body);
  if (r.error) return r.error;
  const affected = await findAffected(ctx, r.value, r.wanted);
  return { status: 200, body: {
    summary: { dates: r.value.dates.length, rowsToAdd: r.plan.toInsert.length, alreadyBlocked: r.plan.alreadyBlocked.length, coveredByWholeDay: r.plan.covered.length },
    rows: r.plan.toInsert.slice(0, 500).map((w) => ({ date: w.date, startTime: hhmm(w.start_time) })),
    affected,
  } };
}

// ---------- POST blocks: add ----------
async function add(ctx, body) {
  const missing = await checkTables(ctx, { needLog: true });
  if (missing) return missing;
  const r = await plan(ctx, body);
  if (r.error) return r.error;
  const { value } = r;

  const affected = await findAffected(ctx, value, r.wanted);
  if ((affected.bookings.length || affected.holds.length) && !value.acknowledge) {
    return { status: 409, body: { error: 'This would affect existing bookings or active holds. Review them and confirm.', code: 'AFFECTED_NEEDS_ACK', affected } };
  }

  const rows = r.plan.toInsert.map((w) => ({ date: w.date, start_time: w.start_time, reason: value.reason }));
  let inserted = [];
  if (rows.length) {
    const first = await ctx.supabase.from('availability_blocks').insert(rows).select('id, date, start_time, reason, created_at');
    if (!first.error) inserted = first.data || [];
    else if (first.error.code === '23505') { // someone added one of them meanwhile: add the rest one by one
      for (const row of rows) {
        const one = await ctx.supabase.from('availability_blocks').insert(row).select('id, date, start_time, reason, created_at');
        if (!one.error) inserted.push(...(one.data || []));
        else if (one.error.code !== '23505') throw one.error;
      }
    } else throw first.error;
  }

  let logged = null;
  if (inserted.length) {
    logged = await logAction(ctx, 'block_add', {
      from: value.from, to: value.to, wholeDay: value.wholeDay, slots: value.slots.map(hhmm), weekdays: value.weekdays, reason: value.reason,
      added: inserted.length, ids: inserted.map((b) => b.id), acknowledgedAffected: !!(affected.bookings.length || affected.holds.length),
    });
  }
  return { status: inserted.length ? 201 : 200, body: {
    added: inserted.length, alreadyBlocked: r.plan.alreadyBlocked.length, coveredByWholeDay: r.plan.covered.length,
    blocks: inserted.map(shapeBlock), affected, logged,
  } };
}

// ---------- DELETE blocks: remove by id, or every block on one date ----------
async function remove(ctx, query) {
  const missing = await checkTables(ctx, { needLog: true });
  if (missing) return missing;
  const v = B.validateRemove(query);
  if (!v.ok) return bad(v.error);

  let q = ctx.supabase.from('availability_blocks').select('id, date, start_time, reason');
  q = v.value.id ? q.eq('id', v.value.id) : q.eq('date', v.value.date);
  const found = await q;
  if (found.error) throw found.error;
  const rows = found.data || [];
  if (!rows.length) return { status: 404, body: { error: 'No such block.' } };

  const del = await ctx.supabase.from('availability_blocks').delete().in('id', rows.map((r) => r.id));
  if (del.error) throw del.error;
  const logged = await logAction(ctx, 'block_remove', { by: v.value.id ? 'id' : 'date', ...v.value, removed: rows.length, rows: rows.map((r) => ({ id: r.id, date: r.date, startTime: hhmm(r.start_time), reason: r.reason || null })) });
  return { status: 200, body: { removed: rows.length, logged } };
}

module.exports = { list, preview, add, remove, MIGRATION_MESSAGE };
