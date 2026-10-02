// Run with:  node --test tests/*.test.js
// The booking window: customers can book up to and including 31 Dec 2027 (Chiang Mai time), judged on the
// Chiang Mai calendar date. Uses an in-memory database and a frozen clock; nothing real is touched.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { createFakeDb } = require('./helpers/fake-supabase');

const db = createFakeDb();
const stub = (rel, exports) => { const p = require.resolve(path.join('..', rel)); require.cache[p] = { id: p, filename: p, loaded: true, exports }; };
stub('lib/supabase.js', { getSupabase: () => db.client });
const stripeCalls = { created: 0 };
stub('lib/stripe.js', { getStripe: () => ({ paymentIntents: {
  create: async () => { stripeCalls.created++; return { id: 'pi_test_' + stripeCalls.created, client_secret: 'cs_test' }; },
  cancel: async () => ({ status: 'canceled' }), retrieve: async () => ({ status: 'canceled' }),
} }) });

const Tz = require('../assets/timezone');
const CFG = require('../still.config.js');
const avail = require('../lib/availability');
const adminBlocks = require('../lib/admin-blocks');
const B = require('../lib/blocks');
const holdHandler = require('../api/still/hold.js');
const cpiHandler = require('../api/still/create-payment-intent.js');

const LAST = '2027-12-31';
const NOW = new Date('2026-10-02T03:00:00Z'); // 10:00 Chiang Mai
const freeze = (t) => { test.mock.timers.enable({ apis: ['Date'], now: t }); };
const unfreeze = () => test.mock.timers.reset();
const reset = () => { Object.keys(db.tables).forEach((t) => { db.tables[t].length = 0; }); db.log.writes.length = 0; stripeCalls.created = 0; };
const mockRes = () => { const out = {}; return [{ status(c) { out.status = c; return this; }, json(b) { out.body = b; } }, out]; };
const call = async (h, body) => { const [res, out] = mockRes(); await h({ method: 'POST', body, headers: {} }, res); return out; };
const addSlot = (date, t = '21:00:00') => { const r = { id: `${date}-${t}`, date, start_time: t, booked: false, locked_until: null, locked_by: null }; db.tables.availability.push(r); return r; };

test('the end date lives in still.config.js and everything reads it', () => {
  assert.strictEqual(CFG.booking.lastBookableDate, LAST);
  assert.strictEqual(avail.windowEndISO(), LAST);
});

test('last bookable day vs first non-bookable day (Chiang Mai date)', () => {
  assert.strictEqual(avail.isBeyondWindow('2027-12-31'), false);
  assert.strictEqual(avail.isBeyondWindow('2028-01-01'), true);
  assert.strictEqual(avail.isBeyondWindow('2027-12-30'), false);
});

test('opening a month creates only that month, 4 rows a day, never past 31 Dec 2027', async () => {
  reset(); freeze(NOW);
  try {
    await avail.getMonthAvailability(2026, 11);
    assert.strictEqual(db.tables.availability.length, 30 * 4);
    assert.ok(db.tables.availability.every((r) => r.date.startsWith('2026-11')));
    await avail.getMonthAvailability(2027, 12);
    const dec = db.tables.availability.filter((r) => r.date.startsWith('2027-12'));
    assert.strictEqual(dec.length, 31 * 4);
    assert.strictEqual(dec.map((r) => r.date).sort().pop(), LAST);
    const before = db.tables.availability.length;
    for (const [y, m] of [[2028, 1], [2028, 2], [2030, 6], [1999, 5]]) {
      const r = await avail.getMonthAvailability(y, m);
      assert.deepStrictEqual(r.slots, []); assert.strictEqual(r.windowEnd, LAST);
    }
    assert.strictEqual(db.tables.availability.length, before, 'months past the end create nothing');
    // even a direct call asking for more is clamped
    await avail.getMonthAvailability(2027, 12);
    assert.ok(db.tables.availability.every((r) => r.date <= LAST));
  } finally { unfreeze(); }
});

test('hold: 31 Dec 2027 21:00 works, 1 Jan 2028 is rejected by the server', async () => {
  reset(); freeze(NOW);
  try {
    const last = addSlot('2027-12-31'); const next = addSlot('2028-01-01', '09:00:00');
    const ok = await call(holdHandler, { availability_id: last.id, hold_token: 'tok-1' });
    assert.strictEqual(ok.status, 200);
    const bad = await call(holdHandler, { availability_id: next.id, hold_token: 'tok-1' });
    assert.strictEqual(bad.status, 409); assert.match(bad.body.error, /last bookable day/);
    assert.strictEqual(next.locked_by, null, 'nothing was locked');
  } finally { unfreeze(); }
});

test('create-payment-intent rejects a slot past the end before any payment is created', async () => {
  reset(); freeze(NOW);
  try {
    const next = addSlot('2028-01-01', '09:00:00');
    Object.assign(next, { locked_by: 'tok-2', locked_until: new Date(Date.now() + 600000).toISOString() });
    const out = await call(cpiHandler, { availability_ids: [next.id], hold_token: 'tok-2', first_name: 'A', last_name: 'B', email: 'a@example.com' });
    assert.strictEqual(out.status, 409); assert.strictEqual(stripeCalls.created, 0);
    const last = addSlot('2027-12-31');
    Object.assign(last, { locked_by: 'tok-3', locked_until: new Date(Date.now() + 600000).toISOString() });
    const ok = await call(cpiHandler, { availability_ids: [last.id], hold_token: 'tok-3', first_name: 'A', last_name: 'B', email: 'a@example.com' });
    assert.strictEqual(ok.status, 200); assert.strictEqual(stripeCalls.created, 1);
  } finally { unfreeze(); }
});

test('24-hour lead time is unchanged, right at the boundary', async () => {
  reset();
  const s = addSlot('2026-10-03', '09:00:00'); // 09:00 Chiang Mai = 02:00Z
  freeze(new Date('2026-10-02T02:00:00Z')); // exactly 24h before
  try { assert.strictEqual((await call(holdHandler, { availability_id: s.id, hold_token: 't' })).status, 200); } finally { unfreeze(); }
  const s2 = addSlot('2026-10-03', '13:00:00');
  freeze(new Date('2026-10-02T06:00:01Z')); // 1 second short of 24h
  try { assert.strictEqual((await call(holdHandler, { availability_id: s2.id, hold_token: 't' })).status, 409); } finally { unfreeze(); }
});

test('customer time zones in December 2027: which local month/day each Chiang Mai slot lands in', () => {
  const at = (date, t, tz) => Tz.localDate(Tz.slotInstant(date, t), tz);
  // Los Angeles is 15h behind: 09:00 Chiang Mai on 31 Dec is still 30 Dec; 21:00 is already 31 Dec (06:00).
  assert.strictEqual(at('2027-12-31', '09:00:00', 'America/Los_Angeles'), '2027-12-30');
  assert.strictEqual(at('2027-12-31', '21:00:00', 'America/Los_Angeles'), '2027-12-31');
  assert.strictEqual(at('2027-12-31', '21:00:00', 'Asia/Bangkok'), '2027-12-31');
  // Auckland is 6h ahead: the 21:00 slot is 1 Jan 2028 there (03:00), so Auckland's January has exactly one slot.
  assert.strictEqual(at('2027-12-31', '21:00:00', 'Pacific/Auckland'), '2028-01-01');
  assert.strictEqual(at('2027-12-31', '17:00:00', 'Pacific/Auckland'), '2027-12-31');
  // the booking page works out "last local day" the same way it always has: end of the Chiang Mai day, in the viewer's zone
  const localEnd = (tz) => Tz.localDate(Tz.slotInstant(LAST, '23:59:59'), tz);
  assert.strictEqual(localEnd('America/Los_Angeles'), '2027-12-31');
  assert.strictEqual(localEnd('Asia/Bangkok'), '2027-12-31');
  assert.strictEqual(localEnd('Pacific/Auckland'), '2028-01-01');
  // which Chiang Mai months the page must fetch for the viewer's December / January
  const m = (y, mo, tz) => Tz.chiangMaiMonthsForLocalMonth(y, mo, tz).map((x) => `${x.year}-${x.month}`);
  assert.deepStrictEqual(m(2027, 12, 'Asia/Bangkok'), ['2027-12']);
  assert.deepStrictEqual(m(2027, 12, 'America/Los_Angeles'), ['2027-12', '2028-1']); // never more than two months per view
  assert.deepStrictEqual(m(2027, 12, 'Pacific/Auckland'), ['2027-11', '2027-12']);
  assert.deepStrictEqual(m(2028, 1, 'Pacific/Auckland'), ['2027-12', '2028-1']);
});

test('admin block-out: allowed up to the end + 90 days margin; 120 days still works near the end', () => {
  const ctx = { today: '2026-10-02', windowEnd: avail.windowEndISO(), slotTimes: avail.SLOT_TIMES };
  const maxDate = B.addDays(LAST, B.WINDOW_MARGIN_DAYS);
  assert.strictEqual(maxDate, '2028-03-30');
  assert.ok(B.validateBlockRequest({ date: LAST, wholeDay: true }, ctx).ok);
  assert.ok(B.validateBlockRequest({ date: maxDate, wholeDay: true }, ctx).ok);
  assert.strictEqual(B.validateBlockRequest({ date: B.addDays(maxDate, 1), wholeDay: true }, ctx).ok, false);
  const r = B.validateBlockRequest({ from: '2027-12-01', to: B.addDays('2027-12-01', 119), wholeDay: true }, ctx);
  assert.ok(r.ok); assert.strictEqual(r.value.dates.length, 120);
  assert.strictEqual(B.validateBlockRequest({ from: '2027-12-01', to: B.addDays('2027-12-01', 120), wholeDay: true }, ctx).ok, false);
});

test('admin list reports the new window end and max date', async () => {
  const out = await adminBlocks.list({ supabase: db.client, now: NOW, slotTimes: avail.SLOT_TIMES, windowEnd: avail.windowEndISO() });
  assert.strictEqual(out.body.windowEnd, LAST); assert.strictEqual(out.body.maxDate, '2028-03-30'); assert.strictEqual(out.body.maxRangeDays, 120);
});
