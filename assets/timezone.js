/*
  Timezone helpers shared by the browser (booking + cancel pages) and the server (emails, API).

  Storage never changes: a session is a Chiang Mai wall-clock date + start_time (UTC+7, no DST). Everything
  here only converts that fixed instant to the viewer's timezone for DISPLAY, using Intl only (no
  hand-written offsets), so daylight saving and half-hour zones come out right.

  Never use anything from here for pricing, availability or lead-time decisions - those stay on the
  real instant (see lib/availability.js).
*/
(function (root) {
  const SOURCE_TZ = 'Asia/Bangkok'; // Chiang Mai: UTC+7 all year
  const SOURCE_OFFSET = '+07:00'; // used only to read the stored wall-clock time as a real instant
  const SOURCE_LABEL = 'Chiang Mai time, GMT+7';

  const cache = new Map();
  function dtf(tz, opts) {
    const key = tz + '|' + JSON.stringify(opts);
    let f = cache.get(key);
    if (!f) { f = new Intl.DateTimeFormat('en-US', Object.assign({ timeZone: tz }, opts)); cache.set(key, f); }
    return f;
  }

  // 'HH:MM' | 'HH:MM:SS' -> 'HH:MM:SS' (or null)
  function normTime(t) {
    const m = String(t == null ? '' : t).match(/^(\d{2}):(\d{2})(?::(\d{2}))?/);
    return m ? `${m[1]}:${m[2]}:${m[3] || '00'}` : null;
  }

  // The real instant of a stored slot (Chiang Mai wall-clock date + start_time).
  function slotInstant(date, startTime) {
    const t = normTime(startTime);
    if (!t || !/^\d{4}-\d{2}-\d{2}$/.test(String(date))) return new Date(NaN);
    return new Date(`${date}T${t}${SOURCE_OFFSET}`);
  }

  // True only for a real IANA zone name the runtime knows (e.g. America/New_York). Offsets like "+07:00" are rejected.
  function isValidTimeZone(tz) {
    if (typeof tz !== 'string' || tz.length < 3 || tz.length > 64) return false;
    if (!/^[A-Za-z][A-Za-z0-9_+\-]*(\/[A-Za-z0-9_+\-]+){0,2}$/.test(tz)) return false;
    try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch (e) { return false; }
  }

  // Browsers often report the legacy alias of a zone (Chrome says Asia/Calcutta for India). Use the current name.
  const LEGACY_NAMES = {
    'Asia/Calcutta': 'Asia/Kolkata', 'Asia/Saigon': 'Asia/Ho_Chi_Minh', 'Asia/Katmandu': 'Asia/Kathmandu',
    'Asia/Rangoon': 'Asia/Yangon', 'Asia/Dacca': 'Asia/Dhaka', 'Europe/Kiev': 'Europe/Kyiv',
    'America/Buenos_Aires': 'America/Argentina/Buenos_Aires', 'Atlantic/Faeroe': 'Atlantic/Faroe',
  };
  function modernName(tz) {
    const m = LEGACY_NAMES[tz];
    return m && isValidTimeZone(m) ? m : tz;
  }

  function detectTimeZone() {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (isValidTimeZone(tz)) return modernName(tz);
    } catch (e) { /* fall through */ }
    return SOURCE_TZ;
  }

  const FALLBACK_ZONES = [
    'Pacific/Honolulu', 'America/Anchorage', 'America/Los_Angeles', 'America/Denver', 'America/Chicago', 'America/New_York',
    'America/Halifax', 'America/Sao_Paulo', 'Atlantic/Reykjavik', 'Europe/London', 'Europe/Lisbon', 'Europe/Paris', 'Europe/Berlin',
    'Europe/Athens', 'Europe/Istanbul', 'Europe/Moscow', 'Africa/Cairo', 'Africa/Johannesburg', 'Africa/Nairobi', 'Asia/Dubai',
    'Asia/Karachi', 'Asia/Kolkata', 'Asia/Dhaka', 'Asia/Bangkok', 'Asia/Jakarta', 'Asia/Singapore', 'Asia/Hong_Kong', 'Asia/Shanghai',
    'Asia/Manila', 'Asia/Tokyo', 'Asia/Seoul', 'Australia/Perth', 'Australia/Adelaide', 'Australia/Sydney', 'Pacific/Auckland', 'UTC',
  ];

  // IANA names for the "change timezone" picker. Always includes the given extras (e.g. the detected zone).
  function listTimeZones(extras) {
    let list = [];
    try { if (typeof Intl.supportedValuesOf === 'function') list = Intl.supportedValuesOf('timeZone').slice(); } catch (e) { /* use fallback */ }
    if (!list.length) list = FALLBACK_ZONES.slice();
    (extras || []).concat([SOURCE_TZ]).forEach((z) => { if (z && isValidTimeZone(z) && !list.includes(z)) list.push(z); });
    return list.sort();
  }

  // Wall-clock parts of an instant in a zone.
  function parts(instant, tz) {
    const out = {};
    dtf(tz, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
      .formatToParts(instant).forEach((p) => { if (p.type !== 'literal') out[p.type] = p.value; });
    return { year: +out.year, month: +out.month, day: +out.day, hour: +out.hour % 24, minute: +out.minute, second: +out.second };
  }

  const pad = (n) => String(n).padStart(2, '0');
  function localDate(instant, tz) { const p = parts(instant, tz); return `${p.year}-${pad(p.month)}-${pad(p.day)}`; }

  // Zone offset from UTC at an instant, in minutes (derived from Intl, so DST-correct).
  function offsetMinutes(instant, tz) {
    const p = parts(instant, tz);
    const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    return Math.round((asUTC - Math.floor(instant.getTime() / 1000) * 1000) / 60000);
  }

  function offsetLabel(instant, tz) {
    const m = offsetMinutes(instant, tz);
    if (m === 0) return 'GMT';
    const a = Math.abs(m);
    return `GMT${m < 0 ? '-' : '+'}${Math.floor(a / 60)}${a % 60 ? ':' + pad(a % 60) : ''}`;
  }

  function cityName(tz) {
    if (tz === 'UTC' || tz === 'Etc/UTC') return 'UTC';
    return modernName(tz).split('/').pop().replace(/_/g, ' ');
  }
  function zoneLabel(tz, instant) { return `${cityName(tz)} ${offsetLabel(instant, tz)}`.replace(/^UTC GMT$/, 'UTC'); }

  function clock(instant, tz) { return dtf(tz, { hour: 'numeric', minute: '2-digit' }).format(instant); } // 9:00 PM
  const dayLongF = (tz) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long' });
  const dayShortF = (tz) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' });
  function dayLong(instant, tz) { return dayLongF(tz).format(instant); } // Tuesday 6 October
  function dayShort(instant, tz) { return dayShortF(tz).format(instant); } // Tue 6 Oct

  // Wall-clock (y-m-d h:min in zone) -> instant. Two-pass so it is right across DST changes.
  function zonedInstant(y, m, d, h, min, tz) {
    const guess = Date.UTC(y, m - 1, d, h, min);
    let inst = new Date(guess - offsetMinutes(new Date(guess), tz) * 60000);
    const again = offsetMinutes(inst, tz);
    inst = new Date(guess - again * 60000);
    return inst;
  }

  // Which Chiang Mai months (the availability API groups slots by Chiang Mai month) hold slots that fall in the
  // viewer's local month. Returns [{ year, month }] with month 1-12.
  function chiangMaiMonthsForLocalMonth(year, month, tz) {
    const start = zonedInstant(year, month, 1, 0, 0, tz);
    const ny = month === 12 ? year + 1 : year;
    const nm = month === 12 ? 1 : month + 1;
    const end = zonedInstant(ny, nm, 1, 0, 0, tz);
    const a = parts(start, SOURCE_TZ);
    const b = parts(new Date(end.getTime() - 1), SOURCE_TZ); // last instant of the local month
    const months = [];
    let y = a.year, m = a.month;
    while (y < b.year || (y === b.year && m <= b.month)) {
      months.push({ year: y, month: m });
      m++; if (m > 12) { m = 1; y++; }
    }
    return months;
  }

  // "Tuesday 6 October · 9:00 PM (your time, New York GMT-4)". With no/invalid zone: Chiang Mai time with its label.
  // opts.fallbackLabel overrides the Chiang Mai label (the pages use the shorter "(Chiang Mai)").
  function formatWhen(date, startTime, tz, opts) {
    const inst = slotInstant(date, startTime);
    if (isNaN(inst.getTime())) return `${date} ${startTime}`;
    if (isValidTimeZone(tz)) return `${dayLong(inst, tz)} · ${clock(inst, tz)} (your time, ${zoneLabel(tz, inst)})`;
    const label = (opts && opts.fallbackLabel) || `(${SOURCE_LABEL})`;
    return `${dayLong(inst, SOURCE_TZ)} · ${clock(inst, SOURCE_TZ)} ${label}`;
  }

  // For the provider: the session in Chiang Mai time, and in the customer's zone (with its IANA name) when recorded.
  function formatWhenBoth(date, startTime, tz) {
    const inst = slotInstant(date, startTime);
    const chiangMai = isNaN(inst.getTime()) ? `${date} ${startTime}` : `${dayLong(inst, SOURCE_TZ)} · ${clock(inst, SOURCE_TZ)} (${SOURCE_LABEL})`;
    if (isNaN(inst.getTime())) return { chiangMai, customer: null };
    if (!isValidTimeZone(tz)) return { chiangMai, customer: null };
    return { chiangMai, customer: `${dayLong(inst, tz)} · ${clock(inst, tz)} (${zoneLabel(tz, inst)})`, tz };
  }

  const api = {
    SOURCE_TZ, SOURCE_OFFSET, SOURCE_LABEL,
    normTime, slotInstant, isValidTimeZone, modernName, detectTimeZone, listTimeZones,
    parts, localDate, offsetMinutes, offsetLabel, cityName, zoneLabel,
    clock, dayLong, dayShort, zonedInstant, chiangMaiMonthsForLocalMonth,
    formatWhen, formatWhenBoth,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Tz = api;
})(typeof window !== 'undefined' ? window : this);
