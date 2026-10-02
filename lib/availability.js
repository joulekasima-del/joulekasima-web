const { getSupabase } = require('./supabase');
const { loadBlocks, isBlocked } = require('./blocks');
const cfg = require('./config');

// Fixed daily slot times, Chiang Mai time (UTC+7). The booking prototype in docs/
// (still-booking-prototype.html) still has the original three; 21:00 was added later.
const SLOT_TIMES = ['09:00:00', '13:00:00', '17:00:00', '21:00:00'];
// The last bookable day is a fixed Chiang Mai date set in still.config.js (booking.lastBookableDate), not a rolling count.
const HOLD_MINUTES = 15;
// Bookings must be made at least this far ahead of the session's start
// time — no same-day (or "in a few hours") bookings.
const MIN_LEAD_HOURS = 24;

function hoursUntilSlot(date, startTime) {
  const sessionStart = new Date(`${date}T${startTime}+07:00`);
  return (sessionStart.getTime() - Date.now()) / (1000 * 60 * 60);
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function addDaysISO(baseISO, days) {
  const d = new Date(`${baseISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Last bookable day: a fixed Chiang Mai calendar date. Slot dates are Chiang Mai dates too, so a plain
// string compare is the whole check (31 Dec 2027 21:00 is inside; 1 Jan 2028 is not).
function windowEndISO() {
  return cfg.lastBookableDate;
}

function isBeyondWindow(date) {
  return String(date) > windowEndISO();
}

// Lazily creates the fixed-time availability rows for a date range, if they
// don't already exist. Safe to call repeatedly — unique(date, start_time)
// makes this idempotent.
async function ensureSlotsForRange(startISO, endISO) {
  const supabase = getSupabase();
  const rows = [];
  const lastDay = windowEndISO(); // never create rows past the last bookable day, whatever the caller asks for
  if (endISO > lastDay) endISO = lastDay;
  let cursor = startISO;
  while (cursor <= endISO) {
    for (const t of SLOT_TIMES) {
      rows.push({ date: cursor, start_time: t });
    }
    cursor = addDaysISO(cursor, 1);
  }
  const { error } = await supabase.from('availability').upsert(rows, {
    onConflict: 'date,start_time',
    ignoreDuplicates: true,
  });
  if (error) throw error;
}

async function getMonthAvailability(year, month) {
  // month is 1-indexed (1-12)
  const supabase = getSupabase();
  const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const monthEnd = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  const winEnd = windowEndISO();
  const today = todayISO();
  const rangeStart = monthStart < today ? today : monthStart;
  const rangeEnd = monthEnd > winEnd ? winEnd : monthEnd;

  if (rangeStart > rangeEnd) return { slots: [], windowEnd: winEnd };

  await ensureSlotsForRange(rangeStart, rangeEnd);

  const nowISO = new Date().toISOString();
  const { data, error } = await supabase
    .from('availability')
    .select('id, date, start_time, booked, locked_until')
    .gte('date', rangeStart)
    .lte('date', rangeEnd)
    .order('date', { ascending: true })
    .order('start_time', { ascending: true });
  if (error) throw error;

  // Owner-blocked days/slots (table availability_blocks) are simply reported as not available.
  // No reason is ever exposed, and a missing table (migration not run) means no blocks.
  const blocks = await loadBlocks(supabase, rangeStart, rangeEnd);

  const slots = data.map((s) => ({
    id: s.id,
    date: s.date,
    start_time: s.start_time,
    available:
      !s.booked &&
      (!s.locked_until || s.locked_until < nowISO) &&
      hoursUntilSlot(s.date, s.start_time) >= MIN_LEAD_HOURS &&
      !isBlocked(blocks, s.date, s.start_time),
  }));

  return { slots, windowEnd: winEnd };
}

// Server-enforced 15-minute hold. Returns the locked availability row, or
// throws if the slot is already booked or actively held by someone else.
async function holdSlot({ availabilityId, holdToken }) {
  const supabase = getSupabase();

  // date/start_time never change after a row is created, so this read is
  // safe ahead of the atomic update below — no race window on the fields
  // that matter for concurrency (booked/locked_until/locked_by).
  const { data: slot, error: slotErr } = await supabase
    .from('availability')
    .select('date, start_time')
    .eq('id', availabilityId)
    .maybeSingle();
  if (slotErr) throw slotErr;
  if (!slot) throw new Error('SLOT_UNAVAILABLE');
  if (isBeyondWindow(slot.date)) throw new Error('BEYOND_WINDOW');
  if (hoursUntilSlot(slot.date, slot.start_time) < MIN_LEAD_HOURS) {
    throw new Error('TOO_SOON');
  }
  // A day/slot the owner has blocked can't be held (same answer as "just taken": no reason is exposed).
  if (isBlocked(await loadBlocks(supabase, slot.date, slot.date), slot.date, slot.start_time)) {
    throw new Error('SLOT_UNAVAILABLE');
  }

  const nowISO = new Date().toISOString();
  const lockedUntil = new Date(Date.now() + HOLD_MINUTES * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('availability')
    .update({ locked_until: lockedUntil, locked_by: holdToken })
    .eq('id', availabilityId)
    .eq('booked', false)
    .or(`locked_until.is.null,locked_until.lt.${nowISO},locked_by.eq.${holdToken}`)
    .select()
    .maybeSingle();

  if (error) throw error;
  if (!data) {
    throw new Error('SLOT_UNAVAILABLE');
  }
  return data;
}

async function releaseSlot({ availabilityId, holdToken }) {
  const supabase = getSupabase();
  await supabase
    .from('availability')
    .update({ locked_until: null, locked_by: null })
    .eq('id', availabilityId)
    .eq('locked_by', holdToken)
    .eq('booked', false);
}

async function markBooked({ availabilityId, holdToken }) {
  const supabase = getSupabase();
  const nowISO = new Date().toISOString();
  const { data, error } = await supabase
    .from('availability')
    .update({ booked: true, locked_until: null })
    .eq('id', availabilityId)
    .eq('locked_by', holdToken)
    .eq('booked', false)
    .gt('locked_until', nowISO)
    .select()
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('HOLD_EXPIRED');
  return data;
}

module.exports = {
  SLOT_TIMES,
  HOLD_MINUTES,
  MIN_LEAD_HOURS,
  getMonthAvailability,
  holdSlot,
  releaseSlot,
  markBooked,
  todayISO,
  windowEndISO,
  isBeyondWindow,
};
