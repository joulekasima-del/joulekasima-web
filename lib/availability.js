const { getSupabase } = require('./supabase');

// Fixed daily slot times, Chiang Mai time — mirrors the booking prototype's
// SLOT_TIMES (still-booking-prototype.html).
const SLOT_TIMES = ['09:00:00', '13:00:00', '17:00:00'];
const WINDOW_DAYS = 104; // extended from the original 30-day window (decided §6) to run from 19 Sept 2026 through 31 Dec 2026 — a rolling count, so it naturally keeps extending that far ahead as days pass
const HOLD_MINUTES = 15;

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function addDaysISO(baseISO, days) {
  const d = new Date(`${baseISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function windowEndISO() {
  return addDaysISO(todayISO(), WINDOW_DAYS - 1);
}

// Lazily creates the fixed-time availability rows for a date range, if they
// don't already exist. Safe to call repeatedly — unique(date, start_time)
// makes this idempotent.
async function ensureSlotsForRange(startISO, endISO) {
  const supabase = getSupabase();
  const rows = [];
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

  const slots = data.map((s) => ({
    id: s.id,
    date: s.date,
    start_time: s.start_time,
    available: !s.booked && (!s.locked_until || s.locked_until < nowISO),
  }));

  return { slots, windowEnd: winEnd };
}

// Server-enforced 15-minute hold. Returns the locked availability row, or
// throws if the slot is already booked or actively held by someone else.
async function holdSlot({ availabilityId, holdToken }) {
  const supabase = getSupabase();
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
  WINDOW_DAYS,
  HOLD_MINUTES,
  getMonthAvailability,
  holdSlot,
  releaseSlot,
  markBooked,
  todayISO,
  windowEndISO,
};
