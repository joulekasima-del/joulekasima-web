/*
  Blocked times: days or slots the owner has closed (table availability_blocks, migration 0005).

  A block is separate from availability rows ON PURPOSE: availability rows are lazily (re)created by an
  upsert, and booked=true means "a customer booked this", so neither can safely carry an owner's block.

  Public booking enforces blocks in three places (so none can be bypassed): the availability API
  (lib/availability.js getMonthAvailability), hold (holdSlot) and create-payment-intent. All three go through
  loadBlocks()/isBlocked() here. If the table does not exist yet, loadBlocks() returns [] and booking behaves
  exactly as it did before the feature.

  A block never changes an existing booking or an availability row.
*/
const Tz = require('../assets/timezone');

const MAX_RANGE_DAYS = 120; // most days one request may cover (inclusive)
const MAX_REASON_LENGTH = 200;
const WINDOW_MARGIN_DAYS = 90; // blocks may start/end at most this far past the booking window

const ALLOWED_KEYS = ['date', 'from', 'to', 'wholeDay', 'slots', 'weekdays', 'reason', 'acknowledgeAffected'];

// ---------- small helpers ----------
const normTime = (t) => Tz.normTime(t); // 'HH:MM' | 'HH:MM:SS' -> 'HH:MM:SS' (or null)

function isMissingTable(err) {
  return !!err && (err.code === '42P01' || err.code === 'PGRST205' || /could not find the table|relation .* does not exist/i.test(String(err.message || '')));
}

function isDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s; // rejects 2026-02-31 etc.
}
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
const weekdayOf = (iso) => new Date(iso + 'T00:00:00Z').getUTCDay(); // 0 = Sunday; a calendar date has the same weekday everywhere
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------- the one rule ----------
// A slot is blocked when a block exists for its date with start_time null (whole day) or equal to its start_time.
function isBlocked(blocks, date, startTime) {
  const t = normTime(startTime);
  return (blocks || []).some((b) => b.date === date && (b.start_time == null || normTime(b.start_time) === t));
}

// ---------- reading (used by public booking: must never break it) ----------
async function loadBlocks(supabase, fromDate, toDate) {
  const { data, error } = await supabase.from('availability_blocks').select('date, start_time').gte('date', fromDate).lte('date', toDate);
  if (error) {
    if (isMissingTable(error)) return []; // migration not run yet: behave exactly as before
    throw error;
  }
  return data || [];
}

// slots: [{ date, start_time, ... }] -> the ones that are blocked
async function findBlockedSlots(supabase, slots) {
  const dates = (slots || []).map((s) => s.date).filter(Boolean).sort();
  if (!dates.length) return [];
  const blocks = await loadBlocks(supabase, dates[0], dates[dates.length - 1]);
  return slots.filter((s) => isBlocked(blocks, s.date, s.start_time));
}

// ---------- request validation (admin) ----------
// ctx: { today: 'YYYY-MM-DD' (Chiang Mai), windowEnd: 'YYYY-MM-DD', slotTimes: ['09:00:00', ...] }
function validateBlockRequest(body, ctx) {
  const fail = (error) => ({ ok: false, error });
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fail('Send a JSON object.');
  const extra = Object.keys(body).find((k) => !ALLOWED_KEYS.includes(k));
  if (extra) return fail(`Unknown field "${extra}".`);

  let from, to;
  if (body.date !== undefined) {
    if (body.from !== undefined || body.to !== undefined) return fail('Use either "date" or "from"/"to", not both.');
    from = to = body.date;
  } else { from = body.from; to = body.to === undefined ? body.from : body.to; }
  if (!isDate(from) || !isDate(to)) return fail('Dates must be real calendar dates in YYYY-MM-DD form.');
  if (to < from) return fail('The end date is before the start date.');
  if (daysBetween(from, to) + 1 > MAX_RANGE_DAYS) return fail(`A block can cover at most ${MAX_RANGE_DAYS} days at a time.`);
  if (from < ctx.today) return fail("Dates in the past can't be blocked.");
  if (to > addDays(ctx.windowEnd, WINDOW_MARGIN_DAYS)) return fail('That is too far beyond the booking window.');

  const whole = body.wholeDay === true;
  if (body.wholeDay !== undefined && typeof body.wholeDay !== 'boolean') return fail('"wholeDay" must be true or false.');
  let slots = [];
  if (body.slots !== undefined) {
    if (!Array.isArray(body.slots) || body.slots.length > 10) return fail('"slots" must be a short list of times.');
    for (const raw of body.slots) {
      const t = typeof raw === 'string' ? normTime(raw) : null;
      if (!t || !ctx.slotTimes.includes(t)) return fail('Unknown slot time. Use one of the daily slots.');
      if (!slots.includes(t)) slots.push(t);
    }
  }
  if (whole && slots.length) return fail('Choose either the whole day or specific slots, not both.');
  if (!whole && !slots.length) return fail('Choose the whole day or at least one slot.');

  let weekdays = [0, 1, 2, 3, 4, 5, 6];
  if (body.weekdays !== undefined) {
    if (!Array.isArray(body.weekdays) || !body.weekdays.length || body.weekdays.length > 7 || body.weekdays.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) return fail('"weekdays" must be numbers 0 (Sunday) to 6 (Saturday).');
    weekdays = [...new Set(body.weekdays)].sort();
  }

  let reason = null;
  if (body.reason !== undefined && body.reason !== null) {
    if (typeof body.reason !== 'string') return fail('"reason" must be text.');
    if (/[\u0000-\u001f\u007f]/.test(body.reason)) return fail('The reason contains characters that are not allowed.');
    reason = body.reason.trim();
    if (reason.length > MAX_REASON_LENGTH) return fail(`The reason is limited to ${MAX_REASON_LENGTH} characters.`);
    if (!reason) reason = null;
  }
  if (body.acknowledgeAffected !== undefined && typeof body.acknowledgeAffected !== 'boolean') return fail('"acknowledgeAffected" must be true or false.');

  const dates = datesInRange(from, to).filter((d) => weekdays.includes(weekdayOf(d)));
  if (!dates.length) return fail('No dates in that range match the chosen weekdays.');

  return { ok: true, value: { from, to, wholeDay: whole, slots, weekdays, reason, acknowledge: body.acknowledgeAffected === true, dates } };
}

function datesInRange(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

// value -> the block rows it asks for: [{ date, start_time }] (start_time null = whole day)
function expandBlocks(value) {
  const rows = [];
  for (const date of value.dates) {
    if (value.wholeDay) rows.push({ date, start_time: null });
    else for (const t of value.slots) rows.push({ date, start_time: t });
  }
  return rows;
}

// Compare wanted rows with blocks that already exist.
function planInsert(existing, wanted) {
  const have = (date, t) => (existing || []).some((b) => b.date === date && (b.start_time == null ? t == null : t != null && normTime(b.start_time) === normTime(t)));
  const wholeDay = (date) => (existing || []).some((b) => b.date === date && b.start_time == null);
  const toInsert = [], alreadyBlocked = [], covered = [];
  for (const w of wanted) {
    if (have(w.date, w.start_time)) alreadyBlocked.push(w);
    else if (w.start_time != null && wholeDay(w.date)) covered.push(w); // the whole day is already blocked
    else toInsert.push(w);
  }
  return { toInsert, alreadyBlocked, covered };
}

function validateRemove(query) {
  const hasId = query.id !== undefined, hasDate = query.date !== undefined;
  if (hasId === hasDate) return { ok: false, error: 'Give exactly one of "id" or "date".' };
  if (hasId) return UUID.test(String(query.id)) ? { ok: true, value: { id: String(query.id).toLowerCase() } } : { ok: false, error: 'Invalid block id.' };
  return isDate(String(query.date)) ? { ok: true, value: { date: String(query.date) } } : { ok: false, error: 'Dates must be real calendar dates in YYYY-MM-DD form.' };
}

module.exports = {
  MAX_RANGE_DAYS, MAX_REASON_LENGTH, WINDOW_MARGIN_DAYS,
  normTime, isMissingTable, isDate, addDays, daysBetween, weekdayOf, datesInRange,
  isBlocked, loadBlocks, findBlockedSlots,
  validateBlockRequest, expandBlocks, planInsert, validateRemove,
};
