// Run with:  node --test tests/*.test.js
// Expected values below are worked out by hand from known UTC offsets (not computed by the code under test).
// A Chiang Mai slot is UTC+7, so e.g. 09:00 Chiang Mai = 02:00Z, 13:00 = 06:00Z, 17:00 = 10:00Z, 21:00 = 14:00Z.
const test = require('node:test');
const assert = require('node:assert');
const Tz = require('../assets/timezone.js');

const norm = (s) => s.replace(/[  ]/g, ' ');
const local = (date, time, tz) => {
  const i = Tz.slotInstant(date, time);
  return `${Tz.localDate(i, tz)} ${norm(Tz.clock(i, tz))} ${Tz.offsetLabel(i, tz)}`;
};

test('slotInstant reads the stored wall-clock time as UTC+7', () => {
  assert.strictEqual(Tz.slotInstant('2026-10-06', '21:00:00').toISOString(), '2026-10-06T14:00:00.000Z');
  assert.strictEqual(Tz.slotInstant('2026-10-06', '09:00').toISOString(), '2026-10-06T02:00:00.000Z');
  assert.ok(isNaN(Tz.slotInstant('nope', '09:00:00')));
});

// Mon 5 Oct 2026 (before any of the DST changes below, except Adelaide which went ACDT on 4 Oct)
const OCT5 = {
  'Asia/Bangkok':        { '09:00': '2026-10-05 9:00 AM GMT+7',  '13:00': '2026-10-05 1:00 PM GMT+7',  '17:00': '2026-10-05 5:00 PM GMT+7',  '21:00': '2026-10-05 9:00 PM GMT+7' },
  'America/Los_Angeles': { '09:00': '2026-10-04 7:00 PM GMT-7',  '13:00': '2026-10-04 11:00 PM GMT-7', '17:00': '2026-10-05 3:00 AM GMT-7',  '21:00': '2026-10-05 7:00 AM GMT-7' },
  'America/New_York':    { '09:00': '2026-10-04 10:00 PM GMT-4', '13:00': '2026-10-05 2:00 AM GMT-4',  '17:00': '2026-10-05 6:00 AM GMT-4',  '21:00': '2026-10-05 10:00 AM GMT-4' },
  'Europe/London':       { '09:00': '2026-10-05 3:00 AM GMT+1',  '13:00': '2026-10-05 7:00 AM GMT+1',  '17:00': '2026-10-05 11:00 AM GMT+1', '21:00': '2026-10-05 3:00 PM GMT+1' },
  'Asia/Kolkata':        { '09:00': '2026-10-05 7:30 AM GMT+5:30', '13:00': '2026-10-05 11:30 AM GMT+5:30', '17:00': '2026-10-05 3:30 PM GMT+5:30', '21:00': '2026-10-05 7:30 PM GMT+5:30' },
  'Australia/Adelaide':  { '09:00': '2026-10-05 12:30 PM GMT+10:30', '13:00': '2026-10-05 4:30 PM GMT+10:30', '17:00': '2026-10-05 8:30 PM GMT+10:30', '21:00': '2026-10-06 12:30 AM GMT+10:30' },
  'Pacific/Auckland':    { '09:00': '2026-10-05 3:00 PM GMT+13', '13:00': '2026-10-05 7:00 PM GMT+13', '17:00': '2026-10-05 11:00 PM GMT+13', '21:00': '2026-10-06 3:00 AM GMT+13' },
};
for (const [tz, slots] of Object.entries(OCT5)) {
  test(`5 Oct 2026 slots in ${tz}`, () => {
    for (const [t, want] of Object.entries(slots)) assert.strictEqual(local('2026-10-05', t + ':00', tz), want, `${tz} ${t}`);
  });
}

test('month edge: 1 Nov 09:00 Chiang Mai is still 31 Oct for the Americas', () => {
  assert.strictEqual(local('2026-11-01', '09:00:00', 'America/New_York'), '2026-10-31 10:00 PM GMT-4');
  assert.strictEqual(local('2026-11-01', '09:00:00', 'America/Los_Angeles'), '2026-10-31 7:00 PM GMT-7');
  assert.strictEqual(local('2026-11-01', '09:00:00', 'Asia/Bangkok'), '2026-11-01 9:00 AM GMT+7');
});

test('DST - Europe/London ends 25 Oct 2026 (01:00Z)', () => {
  assert.strictEqual(local('2026-10-24', '21:00:00', 'Europe/London'), '2026-10-24 3:00 PM GMT+1'); // 14:00Z, still BST
  assert.strictEqual(local('2026-10-25', '09:00:00', 'Europe/London'), '2026-10-25 2:00 AM GMT');   // 02:00Z, now GMT
  assert.strictEqual(local('2026-10-25', '21:00:00', 'Europe/London'), '2026-10-25 2:00 PM GMT');
});

test('DST - America/New_York ends 1 Nov 2026 (06:00Z)', () => {
  assert.strictEqual(local('2026-11-01', '09:00:00', 'America/New_York'), '2026-10-31 10:00 PM GMT-4'); // 02:00Z, EDT
  assert.strictEqual(local('2026-11-01', '13:00:00', 'America/New_York'), '2026-11-01 1:00 AM GMT-5');  // 06:00Z = the change instant
  assert.strictEqual(local('2026-11-01', '17:00:00', 'America/New_York'), '2026-11-01 5:00 AM GMT-5');
  assert.strictEqual(local('2026-11-01', '21:00:00', 'America/New_York'), '2026-11-01 9:00 AM GMT-5');
});

test('which Chiang Mai months hold a local month (availability API groups by Chiang Mai month)', () => {
  const ym = (a) => a.map((x) => `${x.year}-${String(x.month).padStart(2, '0')}`).join(',');
  assert.strictEqual(ym(Tz.chiangMaiMonthsForLocalMonth(2026, 10, 'Asia/Bangkok')), '2026-10');
  assert.strictEqual(ym(Tz.chiangMaiMonthsForLocalMonth(2026, 10, 'America/New_York')), '2026-10,2026-11'); // 31 Oct evening = 1 Nov Chiang Mai
  assert.strictEqual(ym(Tz.chiangMaiMonthsForLocalMonth(2026, 11, 'America/New_York')), '2026-11,2026-12');
  assert.strictEqual(ym(Tz.chiangMaiMonthsForLocalMonth(2026, 11, 'Pacific/Auckland')), '2026-10,2026-11');
  assert.strictEqual(ym(Tz.chiangMaiMonthsForLocalMonth(2026, 12, 'America/Los_Angeles')), '2026-12,2027-01');
});

test('isValidTimeZone', () => {
  for (const ok of ['America/New_York', 'Asia/Kolkata', 'Asia/Calcutta', 'Australia/Adelaide', 'UTC', 'America/Argentina/Buenos_Aires']) assert.ok(Tz.isValidTimeZone(ok), ok);
  for (const bad of ['', 'Mars/Phobos', '+07:00', 'GMT+7 ', 'x'.repeat(80), null, undefined, 5, '../etc/passwd', 'America/New_York; drop table', 'America//New_York']) assert.ok(!Tz.isValidTimeZone(bad), String(bad));
});

test('formatWhen: customer zone, and the Chiang Mai fallback when the zone is missing or invalid', () => {
  assert.strictEqual(norm(Tz.formatWhen('2026-10-06', '21:00:00', 'America/New_York')), 'Tuesday 6 October · 10:00 AM (your time, New York GMT-4)');
  assert.strictEqual(norm(Tz.formatWhen('2026-10-06', '21:00:00', 'Asia/Bangkok')), 'Tuesday 6 October · 9:00 PM (your time, Bangkok GMT+7)');
  for (const t of [undefined, null, '', 'Nope/Zone']) {
    assert.strictEqual(norm(Tz.formatWhen('2026-10-06', '21:00:00', t)), 'Tuesday 6 October · 9:00 PM (Chiang Mai time, GMT+7)');
  }
  assert.strictEqual(norm(Tz.formatWhen('2026-10-06', '21:00:00', null, { fallbackLabel: '(Chiang Mai)' })), 'Tuesday 6 October · 9:00 PM (Chiang Mai)');
});

test('legacy zone names show their current city (Chrome reports Asia/Calcutta for India)', () => {
  assert.strictEqual(Tz.modernName('Asia/Calcutta'), 'Asia/Kolkata');
  assert.strictEqual(Tz.cityName('Asia/Calcutta'), 'Kolkata');
  assert.strictEqual(norm(Tz.formatWhen('2026-10-06', '21:00:00', 'Asia/Calcutta')), 'Tuesday 6 October · 7:30 PM (your time, Kolkata GMT+5:30)');
});

test('formatWhenBoth gives Chiang Mai and the customer view', () => {
  const b = Tz.formatWhenBoth('2026-10-06', '21:00:00', 'Asia/Kolkata');
  assert.strictEqual(norm(b.chiangMai), 'Tuesday 6 October · 9:00 PM (Chiang Mai time, GMT+7)');
  assert.strictEqual(norm(b.customer), 'Tuesday 6 October · 7:30 PM (Kolkata GMT+5:30)');
  assert.strictEqual(Tz.formatWhenBoth('2026-10-06', '21:00:00', null).customer, null);
});
