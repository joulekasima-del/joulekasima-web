// Run with:  node --test tests/*.test.js
// Security tests for lib/admin.js. Secrets are random values generated here at run time; nothing real is used.
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const path = require('path');

// Fake database, installed BEFORE lib/admin.js loads. `calls` counts every query, so we can prove that
// unauthenticated requests never reach the database.
const calls = { n: 0 };
const ROW = (o) => Object.assign({
  reference: 'ST-TEST0001', status: 'confirmed', first_name: 'Test', last_name: 'Person', email: 'test@example.com', phone: null, notes: null,
  call_link: 'https://meet.example/abc', currency: 'USD', amount_paid_minor: 2500, customer_timezone: null, created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z',
  cancel_token: 'SECRET-CANCEL-TOKEN', hold_token: 'SECRET-HOLD-TOKEN', stripe_payment_intent_id: 'pi_SECRET', stripe_refund_id: null,
  availability: { date: '2099-01-01', start_time: '09:00:00' },
}, o);
let rows = [];
const supaPath = require.resolve(path.join('..', 'lib', 'supabase.js'));
require.cache[supaPath] = { id: supaPath, filename: supaPath, loaded: true, exports: { getSupabase: () => ({
  from: () => { calls.n++; const q = { select: () => q, in: () => q, order: () => q, limit: async () => ({ data: rows, error: null }) }; return q; },
}) } };
const admin = require('../lib/admin.js');
admin._test.setSleep(async () => {});

const PASSWORD = crypto.randomBytes(12).toString('hex');
const SECRET = crypto.randomBytes(36).toString('base64url');
const setEnv = (pw, secret) => {
  if (pw === undefined) delete process.env.ADMIN_PASSWORD; else process.env.ADMIN_PASSWORD = pw;
  if (secret === undefined) delete process.env.ADMIN_SESSION_SECRET; else process.env.ADMIN_SESSION_SECRET = secret;
};

function call(route, { method = 'GET', body, cookie, ip = '203.0.113.9', headers = {} } = {}) {
  const req = { method, query: { admin: route }, body, headers: Object.assign({ host: 'example.test', 'x-forwarded-for': ip }, cookie ? { cookie } : {}, headers) };
  const out = { headers: {} };
  const res = { setHeader: (k, v) => { out.headers[k.toLowerCase()] = v; }, status(c) { out.status = c; return this; }, json(b) { out.body = b; } };
  return admin.handle(req, res).then(() => out);
}
const cookieOf = (out) => (out.headers['set-cookie'] || '').split(';')[0];
async function signIn() { const r = await call('login', { method: 'POST', body: { password: PASSWORD } }); assert.strictEqual(r.status, 200); return cookieOf(r); }
const reset = () => { calls.n = 0; admin._test.failures.clear(); rows = []; setEnv(PASSWORD, SECRET); };

test('fails closed when either env var is missing, empty, or the secret is too short', async () => {
  for (const [pw, secret] of [[undefined, SECRET], [PASSWORD, undefined], ['', SECRET], [PASSWORD, ''], [PASSWORD, 'short-secret'], [undefined, undefined]]) {
    reset(); setEnv(pw, secret);
    for (const [route, method] of [['login', 'POST'], ['bookings', 'GET'], ['logout', 'POST']]) {
      const r = await call(route, { method, body: { password: PASSWORD } });
      assert.strictEqual(r.status, 503, `${route} with pw=${!!pw} secret=${secret && secret.length}`);
      assert.ok(!/admin_session=[^;]+/.test(r.headers['set-cookie'] || '') || /Max-Age=0/.test(r.headers['set-cookie']), 'must never set a session');
    }
    assert.strictEqual(calls.n, 0, 'no database access');
  }
});

test('wrong password is rejected with no cookie (and the delay is applied)', async () => {
  reset();
  let slept = 0; admin._test.setSleep(async (ms) => { slept = ms; });
  let n = 0;
  for (const body of [{ password: 'nope' }, { password: '' }, {}, { password: 123 }, { password: 'x'.repeat(500) }, undefined]) {
    const r = await call('login', { method: 'POST', body, ip: `192.0.2.${++n}` }); // one IP each, so the lockout isn't hit here
    assert.strictEqual(r.status, 401);
    assert.ok(!r.headers['set-cookie']);
    assert.ok(!JSON.stringify(r.body).includes(PASSWORD));
  }
  assert.ok(slept >= 600, 'a wrong password waits at least 600ms');
  admin._test.setSleep(async () => {});
});

test('correct password sets a signed HttpOnly, Secure, SameSite=Strict, 7-day cookie and leaks nothing', async () => {
  reset();
  const r = await call('login', { method: 'POST', body: { password: PASSWORD } });
  assert.strictEqual(r.status, 200);
  const sc = r.headers['set-cookie'];
  assert.match(sc, /^admin_session=v1\.\d+\.[\w-]+\.[\w-]+;/);
  for (const flag of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Max-Age=604800', 'Path=/api/forms']) assert.ok(sc.includes(flag), flag);
  assert.ok(!sc.includes(PASSWORD) && !sc.includes(SECRET) && !JSON.stringify(r.body).includes(PASSWORD));
  const token = sc.split(';')[0].split('=')[1];
  assert.ok(admin.verifyToken({ password: PASSWORD, secret: SECRET }, token));
  const exp = Number(token.split('.')[1]); const now = Date.now() / 1000;
  assert.ok(exp > now + 604800 - 5 && exp <= now + 604800 + 5, 'expires in 7 days');
});

test('data route: no cookie -> 401 and the database is never touched', async () => {
  reset(); rows = [ROW({})];
  const r = await call('bookings');
  assert.strictEqual(r.status, 401);
  assert.strictEqual(calls.n, 0);
  assert.deepStrictEqual(Object.keys(r.body), ['error']);
});

test('tampered, expired, foreign-secret, future-dated and password-rotated tokens are rejected before any query', async () => {
  reset(); rows = [ROW({})];
  const good = (await signIn()).split('=')[1];
  const cfg = { password: PASSWORD, secret: SECRET };
  const parts = good.split('.');
  const flip = parts[3].slice(-1) === 'A' ? 'B' : 'A';
  const bad = {
    garbage: 'abc', empty: '', tamperedSig: parts.slice(0, 3).join('.') + '.' + parts[3].slice(0, -1) + flip,
    tamperedExp: ['v1', String(Number(parts[1]) + 1000), parts[2], parts[3]].join('.'),
    expired: admin.issueToken(cfg, Date.now() - 8 * 24 * 3600 * 1000),
    otherSecret: admin.issueToken({ password: PASSWORD, secret: crypto.randomBytes(40).toString('base64url') }),
    otherPassword: admin.issueToken({ password: 'a-different-password', secret: SECRET }),
    farFuture: (() => { const exp = Math.floor(Date.now() / 1000) + 30 * 24 * 3600; const payload = `v1.${exp}.nonce`; return `${payload}.${crypto.createHmac('sha256', SECRET).update(payload).digest('base64url')}`; })(),
  };
  for (const [name, token] of Object.entries(bad)) {
    const r = await call('bookings', { cookie: `admin_session=${token}` });
    assert.strictEqual(r.status, 401, name);
  }
  assert.strictEqual(calls.n, 0, 'database never touched');
  // rotating ADMIN_PASSWORD signs the existing (valid) session out
  setEnv('rotated-' + PASSWORD, SECRET);
  assert.strictEqual((await call('bookings', { cookie: `admin_session=${good}` })).status, 401);
  setEnv(PASSWORD, SECRET);
  assert.strictEqual((await call('bookings', { cookie: `admin_session=${good}` })).status, 200);
});

test('authenticated data: grouped, sorted, pending excluded, tokens/ids never returned', async () => {
  reset();
  const inOneHour = new Date(Date.now() + 3600e3).toISOString();
  const cm = (iso) => { const d = new Date(new Date(iso).getTime() + 7 * 3600e3).toISOString(); return { date: d.slice(0, 10), start_time: d.slice(11, 19) }; };
  rows = [
    ROW({ reference: 'ST-LATER', availability: { date: '2099-03-01', start_time: '13:00:00' }, customer_timezone: 'America/New_York' }),
    ROW({ reference: 'ST-SOON', availability: cm(inOneHour) }),
    ROW({ reference: 'ST-PAST', availability: { date: '2020-01-01', start_time: '09:00:00' } }),
    ROW({ reference: 'ST-PENDING', status: 'pending' }),
    ROW({ reference: 'ST-EXPIRED', status: 'expired' }),
    ROW({ reference: 'ST-CANC', status: 'cancelled_by_participant', refund_amount_minor: 2500, stripe_refund_id: 're_SECRET' }),
  ];
  const cookie = await signIn();
  const r = await call('bookings', { cookie });
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.body.upcoming.map((x) => x.reference), ['ST-SOON', 'ST-LATER']);
  assert.deepStrictEqual(r.body.past.map((x) => x.reference), ['ST-PAST']);
  assert.deepStrictEqual(r.body.cancelled.map((x) => x.reference), ['ST-CANC']);
  const all = JSON.stringify(r.body);
  for (const secret of ['SECRET-CANCEL-TOKEN', 'SECRET-HOLD-TOKEN', 'pi_SECRET', 're_SECRET', 'ST-PENDING', 'ST-EXPIRED', 'hold_token', 'cancel_token']) assert.ok(!all.includes(secret), secret);
  const later = r.body.upcoming[1];
  assert.strictEqual(later.customerLocal.timeZone, 'America/New_York');
  assert.match(later.customerLocal.label, /^New York GMT-[45]$/);
  assert.strictEqual(later.chiangMai.time, '13:00');
  assert.strictEqual(r.body.upcoming[0].customerLocal, null, 'no stored zone -> not shown');
  assert.strictEqual(r.body.cancelled[0].refund.display, '$25.00');
  for (const f of ['reference', 'status', 'firstName', 'lastName', 'email', 'phone', 'notes', 'callLink', 'amount', 'createdAt']) assert.ok(f in later, f);
});

test('a session in progress still counts as upcoming; one that finished does not', () => {
  const now = Date.parse('2026-10-05T14:10:00Z'); // 21:10 Chiang Mai; the 21:00 session runs until 21:30
  const g = admin.groupBookings([ROW({ reference: 'LIVE', availability: { date: '2026-10-05', start_time: '21:00:00' } }), ROW({ reference: 'DONE', availability: { date: '2026-10-05', start_time: '17:00:00' } })], now);
  assert.deepStrictEqual(g.upcoming.map((x) => x.reference), ['LIVE']);
  assert.deepStrictEqual(g.past.map((x) => x.reference), ['DONE']);
});

test('method guards, same-origin check and no-store/noindex headers on every response', async () => {
  reset();
  assert.strictEqual((await call('login', { method: 'GET' })).status, 405);
  assert.strictEqual((await call('bookings', { method: 'POST', cookie: await signIn() })).status, 405);
  assert.strictEqual((await call('nope', { cookie: await signIn() })).status, 404);
  assert.strictEqual((await call('login', { method: 'POST', body: { password: PASSWORD }, headers: { origin: 'https://evil.example' } })).status, 403);
  assert.strictEqual((await call('login', { method: 'POST', body: { password: PASSWORD }, headers: { origin: 'https://example.test' } })).status, 200);
  for (const out of [await call('bookings'), await call('login', { method: 'POST', body: { password: 'x' } }), await call('bookings', { cookie: await signIn() })]) {
    assert.strictEqual(out.headers['cache-control'], 'no-store');
    assert.match(out.headers['x-robots-tag'], /noindex/);
  }
});

test('logout clears the cookie', async () => {
  reset();
  const r = await call('logout', { method: 'POST' });
  assert.strictEqual(r.status, 200);
  assert.match(r.headers['set-cookie'], /^admin_session=; .*Max-Age=0/);
});

test('brute force: 5 wrong passwords lock that IP out (even for the right password); other IPs are unaffected', async () => {
  reset();
  for (let i = 0; i < 5; i++) assert.strictEqual((await call('login', { method: 'POST', body: { password: 'wrong' + i }, ip: '198.51.100.7' })).status, 401);
  const locked = await call('login', { method: 'POST', body: { password: PASSWORD }, ip: '198.51.100.7' });
  assert.strictEqual(locked.status, 429);
  assert.ok(Number(locked.headers['retry-after']) > 0);
  assert.ok(!locked.headers['set-cookie']);
  assert.strictEqual((await call('login', { method: 'POST', body: { password: PASSWORD }, ip: '198.51.100.8' })).status, 200);
});

test('constant-time compare does not depend on length or content', () => {
  assert.ok(admin.safeEqual('same', 'same', SECRET));
  assert.ok(!admin.safeEqual('same', 'sam', SECRET));
  assert.ok(!admin.safeEqual('same', 'same ', SECRET));
  assert.ok(!admin.safeEqual('a', 'a'.repeat(1000), SECRET));
});
