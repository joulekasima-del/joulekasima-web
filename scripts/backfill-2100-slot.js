#!/usr/bin/env node
/*
  One-off backfill: add the 21:00 (Chiang Mai time) availability row to every date that already has
  generated rows, from today (UTC date, as lib/availability.js uses) through the end of the booking window.

  - DRY RUN by default: prints what it would insert and exits without writing.
  - Writes only with --apply.
  - Insert-only and idempotent: upsert on (date, start_time) with ignoreDuplicates, so existing rows
    (including any booked or locked ones, and the other times) are never modified, and re-running is a no-op.
  - Reads SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY from the environment, or from .env.local if unset.

  Usage:  node scripts/backfill-2100-slot.js            (dry run)
          node scripts/backfill-2100-slot.js --apply    (performs the inserts)
*/
const fs = require('fs');
const path = require('path');

const envFile = path.join(__dirname, '..', '.env.local');
if (!process.env.SUPABASE_URL && fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

const { getSupabase } = require('../lib/supabase');
const { todayISO, windowEndISO } = require('../lib/availability');

const NEW_TIME = '21:00:00';
const APPLY = process.argv.includes('--apply');

(async () => {
  const supabase = getSupabase();
  const from = todayISO();
  const to = windowEndISO();

  const rows = [];
  for (let start = 0; ; start += 1000) {
    const { data, error } = await supabase
      .from('availability')
      .select('date, start_time')
      .gte('date', from)
      .lte('date', to)
      .order('date')
      .range(start, start + 999);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) break;
  }

  const times = new Map();
  for (const r of rows) {
    if (!times.has(r.date)) times.set(r.date, new Set());
    times.get(r.date).add(r.start_time);
  }
  const missing = [...times.entries()].filter(([, set]) => !set.has(NEW_TIME)).map(([date]) => date).sort();

  console.log(`Window (UTC dates): ${from} -> ${to}`);
  console.log(`Dates with existing rows in window: ${times.size}`);
  console.log(`Dates already having ${NEW_TIME}: ${times.size - missing.length}`);
  console.log(`Rows to insert: ${missing.length}${missing.length ? `  (${missing[0]} -> ${missing[missing.length - 1]})` : ''}`);

  if (!APPLY) {
    console.log('\nDRY RUN - nothing written. Re-run with --apply to insert.');
    return;
  }
  if (!missing.length) return console.log('Nothing to do.');

  for (let i = 0; i < missing.length; i += 500) {
    const chunk = missing.slice(i, i + 500).map((date) => ({ date, start_time: NEW_TIME }));
    const { error } = await supabase.from('availability').upsert(chunk, { onConflict: 'date,start_time', ignoreDuplicates: true });
    if (error) throw error;
  }
  console.log(`Inserted ${missing.length} rows.`);
})().catch((e) => { console.error(e); process.exit(1); });
