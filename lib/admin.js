/*
  Private, read-only admin API for the site owner. Hosted inside api/forms.js (the function count is capped),
  reached as /api/forms?admin=login | logout | bookings. Loaded lazily, so the public forms never depend on it.

  Security model
  - Single password in ADMIN_PASSWORD; sessions are HMAC-signed tokens keyed by a SEPARATE ADMIN_SESSION_SECRET.
  - FAILS CLOSED: if either variable is missing (or the secret is too short) every route answers 503 and nothing
    is granted. Values are never logged, returned, or stored in the repo.
  - The password is compared in constant time. The token carries only an expiry and a random nonce; it is bound to
    the current password, so changing ADMIN_PASSWORD signs everyone out.
  - Cookie: HttpOnly, Secure, SameSite=Strict, 7-day expiry, scoped to /api/forms.
  - Brute force: a short delay on every wrong password (growing with repeated failures) plus a per-IP lockout.
    In-memory, so best-effort on serverless (each warm instance counts separately).
  - Every data route verifies the cookie BEFORE touching the database. GET only; there are no write routes.
*/
const crypto = require('crypto');
const { getSupabase } = require('./supabase');
const Tz = require('../assets/timezone');
const shared = require('../assets/shared');
const { bookingAmountMinor, bookingCurrency } = require('./booking-money');

const COOKIE_NAME = 'admin_session';
const COOKIE_PATH = '/api/forms';
const SESSION_SECONDS = 7 * 24 * 60 * 60;
const MIN_SECRET_LENGTH = 32;
const SESSION_MINUTES = 30; // a session runs 30 minutes (matches lib/finalize-booking.js)

const MAX_FAILS = 5; // wrong passwords per IP per window before a lockout
const FAIL_WINDOW_MS = 15 * 60 * 1000;

let sleep = (ms) => new Promise((r) => setTimeout(r, ms)); // replaceable in tests so wrong-password delays don't slow them down

// ---------- config + crypto ----------
function getAuthConfig() {
  const password = process.env.ADMIN_PASSWORD;
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!password || !secret || secret.length < MIN_SECRET_LENGTH) return null;
  return { password, secret };
}

const hmac = (secret, data) => crypto.createHmac('sha256', secret).update(data).digest();

// Constant-time string comparison that does not leak either length (both sides are hashed first).
function safeEqual(a, b, secret) {
  return crypto.timingSafeEqual(hmac(secret, 'cmp:' + String(a)), hmac(secret, 'cmp:' + String(b)));
}

// Part of every signature: changes when ADMIN_PASSWORD changes, so old sessions stop working.
const passwordTag = (cfg) => hmac(cfg.secret, 'pw:' + cfg.password).toString('hex').slice(0, 16);
const sign = (cfg, payload) => hmac(cfg.secret, `${payload}.${passwordTag(cfg)}`).toString('base64url');

function issueToken(cfg, nowMs = Date.now()) {
  const exp = Math.floor(nowMs / 1000) + SESSION_SECONDS;
  const payload = `v1.${exp}.${crypto.randomBytes(12).toString('base64url')}`;
  return `${payload}.${sign(cfg, payload)}`;
}

function verifyToken(cfg, token, nowMs = Date.now()) {
  if (typeof token !== 'string' || token.length > 300) return false;
  const parts = token.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') return false;
  const exp = Number(parts[1]);
  const nowS = Math.floor(nowMs / 1000);
  if (!Number.isInteger(exp) || exp <= nowS || exp > nowS + SESSION_SECONDS + 60) return false;
  const given = Buffer.from(parts[3], 'base64url');
  const expected = Buffer.from(sign(cfg, parts.slice(0, 3).join('.')), 'base64url');
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

function readCookie(req, name) {
  const header = req.headers && req.headers.cookie;
  if (!header) return null;
  for (const part of String(header).split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

const cookieAttrs = `Path=${COOKIE_PATH}; HttpOnly; Secure; SameSite=Strict`;
const sessionCookie = (token) => `${COOKIE_NAME}=${token}; ${cookieAttrs}; Max-Age=${SESSION_SECONDS}`;
const clearedCookie = () => `${COOKIE_NAME}=; ${cookieAttrs}; Max-Age=0`;

// ---------- brute-force limiter (best effort, in memory) ----------
const failures = new Map(); // ip -> { count, first }
function clientIp(req) {
  const xff = req.headers && req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return (req.headers && req.headers['x-real-ip']) || (req.socket && req.socket.remoteAddress) || 'unknown';
}
function failureState(ip, now = Date.now()) {
  const f = failures.get(ip);
  if (!f || now - f.first > FAIL_WINDOW_MS) { failures.delete(ip); return { count: 0, first: now }; }
  return f;
}
function recordFailure(ip, now = Date.now()) {
  const f = failureState(ip, now);
  f.count += 1;
  failures.set(ip, f);
  if (failures.size > 2000) { for (const [k, v] of failures) if (now - v.first > FAIL_WINDOW_MS) failures.delete(k); }
  return f;
}

// ---------- responses ----------
function send(res, status, body, extraHeaders) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Vary', 'Cookie');
  Object.entries(extraHeaders || {}).forEach(([k, v]) => res.setHeader(k, v));
  res.status(status).json(body);
}

function sameOrigin(req) {
  const origin = req.headers && req.headers.origin;
  if (!origin) return true; // same-origin fetches from some clients omit it; SameSite=Strict still protects the cookie
  const host = (req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  try { return new URL(origin).host === host; } catch (e) { return false; }
}

// ---------- routes ----------
async function login(req, res, cfg) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' }, { Allow: 'POST' });
  if (!sameOrigin(req)) return send(res, 403, { error: 'Forbidden' });

  const ip = clientIp(req);
  const state = failureState(ip);
  if (state.count >= MAX_FAILS) {
    const retry = Math.max(1, Math.ceil((FAIL_WINDOW_MS - (Date.now() - state.first)) / 1000));
    return send(res, 429, { error: 'Too many attempts. Try again later.' }, { 'Retry-After': String(retry) });
  }

  const candidate = req.body && typeof req.body === 'object' ? req.body.password : undefined;
  const ok = typeof candidate === 'string' && candidate.length > 0 && candidate.length <= 200 && safeEqual(candidate, cfg.password, cfg.secret);
  if (!ok) {
    const f = recordFailure(ip);
    await sleep(600 + Math.random() * 400 + Math.min(f.count, 5) * 400); // small, growing delay
    return send(res, 401, { error: 'Incorrect password.' });
  }
  failures.delete(ip);
  return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(issueToken(cfg)) });
}

function logout(req, res, cfg) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' }, { Allow: 'POST' });
  if (!sameOrigin(req)) return send(res, 403, { error: 'Forbidden' });
  return send(res, 200, { ok: true }, { 'Set-Cookie': clearedCookie() });
}

const CANCELLED = ['cancelled_by_participant', 'cancelled_by_provider'];

// One booking row -> the fields the admin page shows. Whitelist only: tokens, hold tokens and Stripe ids never leave the server.
function shapeBooking(b) {
  const a = b.availability || {};
  const inst = Tz.slotInstant(a.date, a.start_time);
  const valid = !isNaN(inst.getTime());
  const tz = Tz.isValidTimeZone(b.customer_timezone) ? b.customer_timezone : null;
  const currency = bookingCurrency(b);
  const paidMinor = bookingAmountMinor(b);
  const refundMinor = b.refund_amount_minor != null ? b.refund_amount_minor
    : (b.refund_amount_thb != null ? b.refund_amount_thb * 100 : null);
  const cancelled = CANCELLED.includes(b.status);
  return {
    reference: b.reference,
    status: b.status,
    startsAt: valid ? inst.toISOString() : null,
    endsAt: valid ? new Date(inst.getTime() + SESSION_MINUTES * 60000).toISOString() : null,
    chiangMai: valid ? { date: a.date, time: Tz.normTime(a.start_time).slice(0, 5), day: Tz.dayLong(inst, Tz.SOURCE_TZ), clock: Tz.clock(inst, Tz.SOURCE_TZ) } : null,
    customerLocal: valid && tz ? { timeZone: tz, day: Tz.dayLong(inst, tz), clock: Tz.clock(inst, tz), label: Tz.zoneLabel(tz, inst) } : null,
    customerTimeZone: tz,
    firstName: b.first_name,
    lastName: b.last_name,
    email: b.email,
    phone: b.phone || null,
    notes: b.notes || null,
    callLink: b.call_link || null,
    calendarSyncFailed: !!b.calendar_sync_failed,
    amount: { minor: paidMinor, currency, display: shared.formatMinor(paidMinor, currency) },
    refund: cancelled
      ? { refunded: !!b.stripe_refund_id || (refundMinor || 0) > 0, minor: refundMinor, display: refundMinor ? shared.formatMinor(refundMinor, currency) : null }
      : null,
    createdAt: b.created_at,
    updatedAt: b.updated_at,
  };
}

// Pure grouping, so it can be tested without a database: confirmed sessions -> upcoming / past, cancelled -> cancelled.
function groupBookings(rows, nowMs = Date.now()) {
  const upcoming = [], past = [], cancelled = [];
  for (const row of rows) {
    const s = shapeBooking(row);
    if (CANCELLED.includes(row.status)) cancelled.push(s);
    else if (row.status === 'confirmed') (s.endsAt && Date.parse(s.endsAt) >= nowMs ? upcoming : past).push(s);
    // anything else (pending = unpaid, expired) is deliberately excluded
  }
  const byStart = (dir) => (x, y) => dir * (Date.parse(x.startsAt || 0) - Date.parse(y.startsAt || 0));
  upcoming.sort(byStart(1));
  past.sort(byStart(-1));
  cancelled.sort(byStart(-1));
  return { upcoming, past, cancelled };
}

async function bookings(req, res, cfg) {
  if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' }, { Allow: 'GET' });
  // Authenticate BEFORE any database access.
  if (!verifyToken(cfg, readCookie(req, COOKIE_NAME))) return send(res, 401, { error: 'Not signed in.' }, { 'Set-Cookie': clearedCookie() });

  const { data, error } = await getSupabase()
    .from('bookings')
    .select('*, availability:availability_id(date, start_time)')
    .in('status', ['confirmed', ...CANCELLED])
    .order('created_at', { ascending: false })
    .limit(2000);
  if (error) {
    console.error('admin bookings query failed:', error.code || '', error.message);
    return send(res, 500, { error: 'Could not load bookings.' });
  }
  const now = Date.now();
  return send(res, 200, { serverTime: new Date(now).toISOString(), ...groupBookings(data || [], now) });
}

// Entry point called from api/forms.js for /api/forms?admin=<route>
async function handle(req, res) {
  try {
    const cfg = getAuthConfig();
    if (!cfg) { // fail closed
      console.error('admin: ADMIN_PASSWORD / ADMIN_SESSION_SECRET not (fully) configured - refusing all admin requests.');
      return send(res, 503, { error: 'Admin is not configured.' }, String(req.query.admin) === 'logout' ? { 'Set-Cookie': clearedCookie() } : undefined);
    }
    const route = String(req.query.admin);
    if (route === 'login') return await login(req, res, cfg);
    if (route === 'logout') return logout(req, res, cfg);
    if (route === 'bookings') return await bookings(req, res, cfg);
    return send(res, 404, { error: 'Not found' });
  } catch (err) {
    console.error('admin error:', err && err.message);
    return send(res, 500, { error: 'Something went wrong.' });
  }
}

module.exports = {
  handle, groupBookings, shapeBooking, issueToken, verifyToken, safeEqual, getAuthConfig, COOKIE_NAME, COOKIE_PATH,
  _test: { failures, setSleep: (fn) => { sleep = fn; } },
};
