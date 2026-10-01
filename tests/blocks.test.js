// Run with:  node --test tests/*.test.js
// Blocked times: pure logic, enforcement in the public booking path (availability API, hold, create-payment-intent),
// the admin routes (auth / origin / validation / logging / affected bookings), and fail-safe behaviour when the
// migration has not been run. Uses an in-memory database and random throwaway secrets; nothing real is touched.
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const path = require('path');
const { createFakeDb } = require('./helpers/fake-supabase');

const db = createFakeDb();
const stub = (rel, exports) => { const p = require.resolve(path.join('..', rel)); require.cache[p] = { id: p, filename: p, loaded: true, exports }; };
stub('lib/supabase.js', { getSupabase: () => db.client });
const stripeCalls = { created: 0, cancelled: 0 };
stub('lib/stripe.js', { getStripe: () => ({ paymentIntents: {
  create: async (o) => { stripeCalls.created++; return { id: 'pi_test_' + stripeCalls.created, client_secret: 'cs_test', amount: o.amount }; },
  cancel: async () => { stripeCalls.cancelled++; return { status: 'canceled' }; },
  retrieve: async () => ({ status: 'canceled' }),
} }) });

const B = require('../lib/blocks');
const Tz = require('../assets/timezone');
const avail = require('../lib/availability');
const admin = require('../lib/admin');
const holdHandler = require('../api/still/hold.js');
const cpiHandler = require('../api/still/create-payment-intent.js');
admin._test.setSleep(async () => {});

const PASSWORD = crypto.randomBytes(12).toString('hex');
const SECRET = crypto.randomBytes(36).toString('base64url');
process.env.ADMIN_PASSWORD = PASSWORD; process.env.ADMIN_SESSION_SECRET = SECRET;

const todayCM = Tz.localDate(new Date(), Tz.SOURCE_TZ);
const D = (n) => B.addDays(todayCM, n);
// a day well inside the booking window and away from month edges
function midMonthDate() { for (let n = 40; n < 90; n++) { const d = D(n); const day = Number(d.slice(8)); if (day >= 6 && day <= 20) return d; } throw new Error('no date'); }
const monthOf = (d) => [Number(d.slice(0, 4)), Number(d.slice(5, 7))];

function reset() {
  Object.keys(db.tables).forEach((t) => { db.tables[t].length = 0; });
  ['availability_blocks', 'admin_actions', 'availability', 'bookings'].forEach((t) => db.restoreTable(t));
  db.log.queries = 0; db.log.writes.length = 0; stripeCalls.created = 0; stripeCalls.cancelled = 0;
  admin._test.failures.clear();
}
const writesTo = (t) => db.log.writes.filter((w) => w.table === t).length;

// ---- tiny HTTP-ish helpers ----
function mockRes() { const out = { headers: {} }; const res = { setHeader: (k, v) => { out.headers[k.toLowerCase()] = v; }, status(c) { out.status = c; return this; }, json(b) { out.body = b; } }; return [res, out]; }
async function callAdmin(route, { method = 'GET', body, cookie, query = {}, headers = {}, ip = '203.0.113.9' } = {}) {
  const [res, out] = mockRes();
  const base = { host: 'example.test', 'x-forwarded-for': ip, ...(method === 'POST' ? { 'content-type': 'application/json' } : {}) };
  await admin.handle({ method, query: { admin: route, ...query }, body, headers: { ...base, ...(cookie ? { cookie } : {}), ...headers } }, res);
  return out;
}
async function signIn() { const [res, out] = mockRes(); await admin.handle({ method: 'POST', query: { admin: 'login' }, body: { password: PASSWORD }, headers: { host: 'example.test', 'x-forwarded-for': '203.0.113.1', 'content-type': 'application/json' } }, res); assert.strictEqual(out.status, 200); return out.headers['set-cookie'].split(';')[0]; }
async function callApi(handler, body) { const [res, out] = mockRes(); await handler({ method: 'POST', body, headers: {} }, res); return out; }
const addBlock = async (cookie, body) => callAdmin('blocks', { method: 'POST', cookie, body });
const slotsOf = (month) => month.slots.reduce((m, s) => { (m[s.date] = m[s.date] || {})[s.start_time.slice(0, 5)] = s.available; return m; }, {});

// =====================================================================
// 1. pure logic
// =====================================================================
test('isBlocked: whole day, single slot, other slot/date, time formats', () => {
  const blocks = [{ date: '2026-12-01', start_time: null }, { date: '2026-12-02', start_time: '21:00:00' }];
  for (const t of ['09:00:00', '13:00', '17:00:00', '21:00:00']) assert.ok(B.isBlocked(blocks, '2026-12-01', t), 'whole day ' + t);
  assert.ok(B.isBlocked(blocks, '2026-12-02', '21:00'));
  assert.ok(B.isBlocked(blocks, '2026-12-02', '21:00:00'));
  assert.ok(!B.isBlocked(blocks, '2026-12-02', '17:00:00'));
  assert.ok(!B.isBlocked(blocks, '2026-12-03', '21:00:00'));
  assert.ok(!B.isBlocked([], '2026-12-01', '09:00:00'));
  assert.ok(!B.isBlocked(null, '2026-12-01', '09:00:00'));
});

const CTX = () => ({ today: todayCM, windowEnd: B.addDays(todayCM, 103), slotTimes: avail.SLOT_TIMES });
test('validateBlockRequest accepts good requests and normalises them', () => {
  let r = B.validateBlockRequest({ date: D(10), wholeDay: true, reason: '  Trip  ' }, CTX());
  assert.ok(r.ok); assert.deepStrictEqual(r.value.dates, [D(10)]); assert.strictEqual(r.value.reason, 'Trip');
  r = B.validateBlockRequest({ from: D(10), to: D(12), slots: ['21:00', '09:00:00', '21:00'] }, CTX());
  assert.ok(r.ok); assert.deepStrictEqual(r.value.slots, ['21:00:00', '09:00:00']); assert.strictEqual(r.value.dates.length, 3);
  r = B.validateBlockRequest({ from: D(10), to: D(10 + 119), wholeDay: true }, CTX());
  assert.ok(r.ok, 'exactly 120 days is allowed'); assert.strictEqual(r.value.dates.length, 120);
  r = B.validateBlockRequest({ from: D(10), to: D(40), wholeDay: true, reason: '' }, CTX());
  assert.strictEqual(r.value.reason, null);
});

test('validateBlockRequest rejects everything unsafe or unclear', () => {
  const bad = (body, re) => { const r = B.validateBlockRequest(body, CTX()); assert.ok(!r.ok, JSON.stringify(body)); if (re) assert.match(r.error, re); };
  bad(null, /JSON object/); bad([], /JSON object/); bad('x', /JSON object/);
  bad({ date: D(10), wholeDay: true, hack: 1 }, /Unknown field/);
  bad({ date: D(10), from: D(10), wholeDay: true }, /either/);
  bad({ date: '2026-02-31', wholeDay: true }, /real calendar/); bad({ date: '2026/12/01', wholeDay: true }, /real calendar/); bad({ date: 20261201, wholeDay: true }, /real calendar/); bad({ wholeDay: true }, /real calendar/);
  bad({ from: D(12), to: D(10), wholeDay: true }, /before/);
  bad({ from: D(10), to: D(10 + 120), wholeDay: true }, /at most 120/);
  bad({ date: D(-1), wholeDay: true }, /past/); bad({ from: D(-3), to: D(5), wholeDay: true }, /past/);
  bad({ date: D(103 + B.WINDOW_MARGIN_DAYS + 1), wholeDay: true }, /too far/);
  bad({ date: D(10) }, /whole day or at least one slot/); bad({ date: D(10), slots: [] }, /whole day or at least one slot/);
  bad({ date: D(10), wholeDay: true, slots: ['09:00'] }, /not both/);
  bad({ date: D(10), slots: ['10:00'] }, /Unknown slot/); bad({ date: D(10), slots: [9] }, /Unknown slot/); bad({ date: D(10), slots: 'x' }, /list of times/);
  bad({ date: D(10), wholeDay: 'yes' }, /true or false/);
  bad({ date: D(10), wholeDay: true, weekdays: [7] }, /weekdays/); bad({ date: D(10), wholeDay: true, weekdays: [] }, /weekdays/); bad({ date: D(10), wholeDay: true, weekdays: ['1'] }, /weekdays/);
  bad({ date: D(10), wholeDay: true, reason: 'x'.repeat(201) }, /limited to 200/); bad({ date: D(10), wholeDay: true, reason: 'a\nb' }, /not allowed/); bad({ date: D(10), wholeDay: true, reason: 5 }, /must be text/);
  bad({ date: D(10), wholeDay: true, acknowledgeAffected: 'true' }, /true or false/);
  // weekday filter that matches nothing in a single day
  const wd = (B.weekdayOf(D(10)) + 1) % 7;
  bad({ date: D(10), wholeDay: true, weekdays: [wd] }, /No dates/);
});

test('expandBlocks / planInsert: range, overlap, idempotence', () => {
  const v = B.validateBlockRequest({ from: D(10), to: D(12), slots: ['09:00', '21:00'] }, CTX()).value;
  const wanted = B.expandBlocks(v);
  assert.strictEqual(wanted.length, 6);
  let p = B.planInsert([], wanted);
  assert.strictEqual(p.toInsert.length, 6);
  p = B.planInsert([{ date: D(10), start_time: '09:00:00' }], wanted); // already there
  assert.deepStrictEqual([p.toInsert.length, p.alreadyBlocked.length, p.covered.length], [5, 1, 0]);
  p = B.planInsert([{ date: D(11), start_time: null }], wanted); // whole day already blocked -> slot blocks are covered
  assert.deepStrictEqual([p.toInsert.length, p.alreadyBlocked.length, p.covered.length], [4, 0, 2]);
  const whole = B.expandBlocks(B.validateBlockRequest({ date: D(11), wholeDay: true }, CTX()).value);
  p = B.planInsert([{ date: D(11), start_time: '09:00:00' }], whole); // slot blocks exist, whole day still gets added
  assert.strictEqual(p.toInsert.length, 1);
  p = B.planInsert([{ date: D(11), start_time: null }], whole);
  assert.strictEqual(p.alreadyBlocked.length, 1);
});

test('validateRemove needs exactly one valid id or date', () => {
  const id = crypto.randomUUID();
  assert.deepStrictEqual(B.validateRemove({ id }).value, { id });
  assert.deepStrictEqual(B.validateRemove({ date: '2026-12-01' }).value, { date: '2026-12-01' });
  for (const q of [{}, { id, date: '2026-12-01' }, { id: 'nope' }, { date: '2026-13-01' }, { id: "1' or '1'='1" }]) assert.ok(!B.validateRemove(q).ok, JSON.stringify(q));
});

// =====================================================================
// 2. public availability API
// =====================================================================
test('availability API: blocked day/slot is "not available", never exposes a reason, and unblocking restores it', async () => {
  reset(); const cookie = await signIn();
  const d1 = midMonthDate(), d2 = B.addDays(d1, 1), d3 = B.addDays(d1, 2); const [Y, M] = monthOf(d1);
  let m = await avail.getMonthAvailability(Y, M);
  assert.ok(slotsOf(m)[d1]['21:00'] && slotsOf(m)[d2]['09:00'], 'open before blocking');

  assert.strictEqual((await addBlock(cookie, { date: d1, wholeDay: true, reason: 'Trip to Laos (private)' })).status, 201);
  assert.strictEqual((await addBlock(cookie, { date: d2, slots: ['21:00'], reason: 'Dentist' })).status, 201);
  m = await avail.getMonthAvailability(Y, M); const s = slotsOf(m);
  assert.deepStrictEqual(Object.values(s[d1]), [false, false, false, false], 'whole day closed');
  assert.deepStrictEqual([s[d2]['09:00'], s[d2]['13:00'], s[d2]['17:00'], s[d2]['21:00']], [true, true, true, false], 'only 21:00 closed');
  assert.ok(s[d3]['21:00'], 'next day unaffected');
  const json = JSON.stringify(m);
  for (const secret of ['Laos', 'Dentist', 'reason', 'block']) assert.ok(!json.toLowerCase().includes(secret.toLowerCase()), 'public response leaks "' + secret + '"');
  assert.deepStrictEqual(Object.keys(m.slots[0]).sort(), ['available', 'date', 'id', 'start_time']);

  assert.strictEqual((await callAdmin('blocks', { method: 'DELETE', cookie, query: { date: d1 } })).status, 200);
  const id2 = db.tables.availability_blocks[0].id;
  assert.strictEqual((await callAdmin('blocks', { method: 'DELETE', cookie, query: { id: id2 } })).status, 200);
  m = await avail.getMonthAvailability(Y, M);
  assert.deepStrictEqual(Object.values(slotsOf(m)[d1]), [true, true, true, true]); assert.ok(slotsOf(m)[d2]['21:00'], 'back after unblock');
});

test('blocked slots are unavailable in every timezone view (the client only regroups the same slots)', async () => {
  reset(); const cookie = await signIn(); const d = midMonthDate(); const [Y, M] = monthOf(d);
  await addBlock(cookie, { date: d, slots: ['21:00', '09:00'] });
  const month = await avail.getMonthAvailability(Y, M);
  let baseline = null;
  for (const tz of ['Asia/Bangkok', 'America/Los_Angeles', 'America/New_York', 'Europe/London', 'Asia/Kolkata', 'Australia/Adelaide', 'Pacific/Auckland']) {
    const view = month.slots.map((s) => ({ key: s.date + 'T' + s.start_time, localDate: Tz.localDate(Tz.slotInstant(s.date, s.start_time), tz), available: s.available }));
    for (const s of view) {
      const blocked = s.key.startsWith(d) && (s.key.endsWith('21:00:00') || s.key.endsWith('09:00:00'));
      if (blocked) assert.strictEqual(s.available, false, `${tz} ${s.key}`);
    }
    const open = view.filter((s) => s.available).map((s) => s.key).join();
    if (baseline === null) baseline = open; else assert.strictEqual(open, baseline, `${tz} sees the same open slots`);
  }
});

// =====================================================================
// 3. hold + create-payment-intent
// =====================================================================
const rowFor = (date, time) => db.tables.availability.find((r) => r.date === date && r.start_time === time + ':00');

test('hold: a blocked slot cannot be held (409, no lock written); unblocked slots still can', async () => {
  reset(); const cookie = await signIn(); const d = midMonthDate(); const [Y, M] = monthOf(d);
  await avail.getMonthAvailability(Y, M);
  await addBlock(cookie, { date: d, slots: ['21:00'] });
  await addBlock(cookie, { date: B.addDays(d, 1), wholeDay: true });
  for (const [date, time] of [[d, '21:00'], [B.addDays(d, 1), '09:00'], [B.addDays(d, 1), '17:00']]) {
    const r = await callApi(holdHandler, { availability_id: rowFor(date, time).id, hold_token: 'tok-1' });
    assert.strictEqual(r.status, 409, `${date} ${time}`);
    assert.match(r.body.error, /just taken/);
    assert.strictEqual(rowFor(date, time).locked_until, null, 'nothing was locked');
  }
  const ok = await callApi(holdHandler, { availability_id: rowFor(d, '13:00').id, hold_token: 'tok-1' });
  assert.strictEqual(ok.status, 200);
  // unblock -> holdable
  await callAdmin('blocks', { method: 'DELETE', cookie, query: { date: d } });
  assert.strictEqual((await callApi(holdHandler, { availability_id: rowFor(d, '21:00').id, hold_token: 'tok-2' })).status, 200);
});

const cpiBody = (ids, token) => ({ availability_ids: ids, hold_token: token, first_name: 'Test', last_name: 'Person', email: 'test@example.test', currency: 'USD' });
test('create-payment-intent: rejects a slot blocked AFTER it was held, before any PaymentIntent exists', async () => {
  reset(); const cookie = await signIn(); const d = midMonthDate(); const [Y, M] = monthOf(d);
  await avail.getMonthAvailability(Y, M);
  const row = rowFor(d, '17:00');
  assert.strictEqual((await callApi(holdHandler, { availability_id: row.id, hold_token: 'tok-9' })).status, 200);

  // blocking something with an active hold needs an explicit acknowledgement
  const refused = await addBlock(cookie, { date: d, slots: ['17:00'] });
  assert.strictEqual(refused.status, 409); assert.strictEqual(refused.body.code, 'AFFECTED_NEEDS_ACK'); assert.strictEqual(refused.body.affected.holds.length, 1);
  assert.strictEqual(db.tables.availability_blocks.length, 0, 'nothing written without acknowledgement');
  assert.strictEqual((await addBlock(cookie, { date: d, slots: ['17:00'], acknowledgeAffected: true })).status, 201);

  const r = await callApi(cpiHandler, cpiBody([row.id], 'tok-9'));
  assert.strictEqual(r.status, 409);
  assert.match(r.body.error, /no longer available/);
  assert.strictEqual(stripeCalls.created, 0, 'no PaymentIntent was created');
  assert.strictEqual(db.tables.bookings.length, 0, 'no booking rows');

  // unblock and the same hold goes through to payment
  await callAdmin('blocks', { method: 'DELETE', cookie, query: { date: d } });
  const ok = await callApi(cpiHandler, cpiBody([row.id], 'tok-9'));
  assert.strictEqual(ok.status, 200);
  assert.strictEqual(stripeCalls.created, 1);
  assert.strictEqual(db.tables.bookings.length, 1);
});

test('blocking never changes an existing confirmed booking or its availability row', async () => {
  reset(); const cookie = await signIn(); const d = midMonthDate(); const [Y, M] = monthOf(d);
  await avail.getMonthAvailability(Y, M);
  const row = rowFor(d, '13:00'); row.booked = true;
  db.tables.bookings.push({ id: crypto.randomUUID(), reference: 'ST-KEEP0001', status: 'confirmed', first_name: 'Keep', last_name: 'Me', email: 'keep@example.test', availability_id: row.id });
  const pv = await callAdmin('block-preview', { method: 'POST', cookie, body: { date: d, wholeDay: true } });
  assert.strictEqual(pv.status, 200);
  assert.deepStrictEqual(pv.body.affected.bookings.map((b) => [b.reference, b.time]), [['ST-KEEP0001', '13:00']]);
  assert.strictEqual(db.tables.availability_blocks.length, 0, 'preview wrote nothing');
  const writesBefore = db.log.writes.length;
  assert.strictEqual((await addBlock(cookie, { date: d, wholeDay: true })).status, 409, 'must acknowledge');
  assert.strictEqual((await addBlock(cookie, { date: d, wholeDay: true, acknowledgeAffected: true })).status, 201);
  assert.strictEqual(db.tables.bookings[0].status, 'confirmed');
  assert.strictEqual(rowFor(d, '13:00').booked, true);
  const changed = db.log.writes.slice(writesBefore).filter((w) => w.table === 'bookings' || w.table === 'availability');
  assert.strictEqual(changed.length, 0, 'no booking/availability write');
});

// =====================================================================
// 4. admin routes: auth, origin, method, content type, validation, logging
// =====================================================================
test('admin block routes: 401 without a cookie (database never touched), 403 for foreign origins, 405/415/400 guards', async () => {
  reset(); const cookie = await signIn(); db.log.queries = 0;
  for (const [route, method, body, query] of [['blocks', 'GET'], ['blocks', 'POST', { date: D(10), wholeDay: true }], ['blocks', 'DELETE', undefined, { date: D(10) }], ['block-preview', 'POST', { date: D(10), wholeDay: true }]]) {
    const r = await callAdmin(route, { method, body, query });
    assert.strictEqual(r.status, 401, `${method} ${route}`);
    assert.deepStrictEqual(Object.keys(r.body), ['error']);
    const bad = await callAdmin(route, { method, body, query, cookie: 'admin_session=garbage' });
    assert.strictEqual(bad.status, 401);
  }
  assert.strictEqual(db.log.queries, 0, 'no query ran without a valid session');

  for (const [route, method, body, query] of [['blocks', 'POST', { date: D(10), wholeDay: true }], ['blocks', 'DELETE', undefined, { date: D(10) }], ['block-preview', 'POST', { date: D(10), wholeDay: true }]]) {
    const r = await callAdmin(route, { method, body, query, cookie, headers: { origin: 'https://evil.example' } });
    assert.strictEqual(r.status, 403, `foreign origin ${method} ${route}`);
  }
  assert.strictEqual(db.tables.availability_blocks.length, 0); assert.strictEqual(db.log.queries, 0);
  assert.strictEqual((await callAdmin('blocks', { method: 'POST', cookie, body: { date: D(10), wholeDay: true }, headers: { origin: 'https://example.test' } })).status, 201, 'same origin is fine');

  assert.strictEqual((await callAdmin('blocks', { method: 'PUT', cookie })).status, 405);
  assert.strictEqual((await callAdmin('block-preview', { method: 'GET', cookie })).status, 405);
  assert.strictEqual((await callAdmin('blocks', { method: 'POST', cookie, body: { date: D(11), wholeDay: true }, headers: { 'content-type': 'text/plain' } })).status, 415);
  assert.strictEqual((await callAdmin('blocks', { method: 'POST', cookie, body: undefined })).status, 400);
  assert.strictEqual((await callAdmin('blocks', { method: 'POST', cookie, body: [1] })).status, 400);
});

test('admin add/remove: strict validation (nothing written on a bad request), idempotent, logged', async () => {
  reset(); const cookie = await signIn();
  for (const body of [{ date: D(-2), wholeDay: true }, { date: '2026-02-31', wholeDay: true }, { from: D(10), to: D(140), wholeDay: true }, { date: D(10), slots: ['11:00'] }, { date: D(10), wholeDay: true, reason: 'x'.repeat(201) }, { date: D(10), wholeDay: true, extra: 1 }, { date: D(900), wholeDay: true }]) {
    assert.strictEqual((await addBlock(cookie, body)).status, 400, JSON.stringify(body).slice(0, 60));
  }
  assert.strictEqual(db.tables.availability_blocks.length, 0); assert.strictEqual(db.tables.admin_actions.length, 0);

  const first = await addBlock(cookie, { from: D(20), to: D(22), slots: ['21:00'], reason: 'Retreat' });
  assert.strictEqual(first.status, 201); assert.strictEqual(first.body.added, 3); assert.strictEqual(first.body.logged, true);
  const again = await addBlock(cookie, { from: D(20), to: D(22), slots: ['21:00'], reason: 'Retreat' });
  assert.strictEqual(again.status, 200); assert.strictEqual(again.body.added, 0); assert.strictEqual(again.body.alreadyBlocked, 3);
  assert.strictEqual(db.tables.availability_blocks.length, 3, 'no duplicates');
  assert.strictEqual(db.tables.admin_actions.length, 1, 'nothing changed, nothing logged');

  const list = await callAdmin('blocks', { cookie });
  assert.strictEqual(list.status, 200);
  assert.deepStrictEqual(list.body.blocks.map((b) => [b.date, b.startTime, b.reason]), [[D(20), '21:00', 'Retreat'], [D(21), '21:00', 'Retreat'], [D(22), '21:00', 'Retreat']]);
  assert.deepStrictEqual(list.body.slotTimes, ['09:00', '13:00', '17:00', '21:00']);

  assert.strictEqual((await callAdmin('blocks', { method: 'DELETE', cookie, query: { id: list.body.blocks[0].id } })).body.removed, 1);
  assert.strictEqual((await callAdmin('blocks', { method: 'DELETE', cookie, query: { id: crypto.randomUUID() } })).status, 404);
  assert.strictEqual((await callAdmin('blocks', { method: 'DELETE', cookie, query: { id: 'x' } })).status, 400);
  assert.strictEqual((await callAdmin('blocks', { method: 'DELETE', cookie, query: {} })).status, 400);

  const actions = db.tables.admin_actions.map((a) => a.action);
  assert.deepStrictEqual(actions, ['block_add', 'block_remove']);
  const logText = JSON.stringify(db.tables.admin_actions);
  assert.ok(!logText.includes(PASSWORD) && !logText.includes(SECRET));
  assert.strictEqual(db.tables.admin_actions[0].payload.added, 3);
});

test('whole day + slots overlap, weekday filter and the 120-day limit', async () => {
  reset(); const cookie = await signIn();
  await addBlock(cookie, { date: D(30), slots: ['21:00'] });
  assert.strictEqual((await addBlock(cookie, { date: D(30), wholeDay: true })).body.added, 1, 'whole day added next to the slot block');
  const covered = await addBlock(cookie, { date: D(30), slots: ['09:00'] });
  assert.strictEqual(covered.body.added, 0); assert.strictEqual(covered.body.coveredByWholeDay, 1);
  assert.strictEqual(db.tables.availability_blocks.length, 2);
  assert.strictEqual((await callAdmin('blocks', { method: 'DELETE', cookie, query: { date: D(30) } })).body.removed, 2, 'unblocking a date removes all its blocks');

  const wd = B.weekdayOf(D(40));
  const r = await addBlock(cookie, { from: D(40), to: D(53), wholeDay: true, weekdays: [wd] });
  assert.strictEqual(r.body.added, 2);
  assert.ok(db.tables.availability_blocks.every((b) => B.weekdayOf(b.date) === wd));

  reset(); const c2 = await signIn();
  const big = await addBlock(c2, { from: D(5), to: D(5 + 119), wholeDay: true });
  assert.strictEqual(big.status, 201); assert.strictEqual(big.body.added, 120);
  assert.strictEqual((await addBlock(c2, { from: D(5), to: D(5 + 120), wholeDay: true })).status, 400);
});

// =====================================================================
// 5. fail-safe: migration not run
// =====================================================================
test('FAIL SAFE: with the tables missing, public booking behaves exactly as before and admin says "run migration"', async () => {
  reset(); const cookie = await signIn(); const d = midMonthDate(); const [Y, M] = monthOf(d);
  const clean = slotsOf(await avail.getMonthAvailability(Y, M));
  db.dropTable('availability_blocks'); db.dropTable('admin_actions');

  const withMissing = slotsOf(await avail.getMonthAvailability(Y, M));
  assert.deepStrictEqual(withMissing, clean, 'availability identical');
  const row = rowFor(d, '13:00');
  assert.strictEqual((await callApi(holdHandler, { availability_id: row.id, hold_token: 't-1' })).status, 200, 'hold works');
  assert.strictEqual((await callApi(cpiHandler, cpiBody([row.id], 't-1'))).status, 200, 'payment starts');
  assert.strictEqual(stripeCalls.created, 1);

  const before = db.log.writes.length;
  for (const [route, method, body, query] of [['blocks', 'GET'], ['blocks', 'POST', { date: D(10), wholeDay: true }], ['block-preview', 'POST', { date: D(10), wholeDay: true }], ['blocks', 'DELETE', undefined, { date: D(10) }]]) {
    const r = await callAdmin(route, { method, body, query, cookie });
    assert.strictEqual(r.status, 503, `${method} ${route}`);
    assert.strictEqual(r.body.code, 'MIGRATION_REQUIRED');
    assert.match(r.body.error, /0005_admin_blocks\.sql/);
  }
  assert.strictEqual(db.log.writes.length, before, 'admin wrote nothing');

  // blocks table exists but the log table doesn't: reading works, writing is refused (every change must be logged)
  db.restoreTable('availability_blocks');
  assert.strictEqual((await callAdmin('blocks', { cookie })).status, 200);
  const refused = await addBlock(cookie, { date: D(10), wholeDay: true });
  assert.strictEqual(refused.status, 503); assert.strictEqual(refused.body.code, 'MIGRATION_REQUIRED');
  assert.strictEqual(db.tables.availability_blocks.length, 0);
});

test('the existing admin bookings route and public availability still work with the blocks code loaded', async () => {
  reset(); const cookie = await signIn();
  const r = await callAdmin('bookings', { cookie });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.upcoming.length, 0);
});
