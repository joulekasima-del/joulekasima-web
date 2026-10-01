-- Backfill the 21:00 (Chiang Mai time) slot for dates that already have generated availability rows.
--
-- Idempotent and insert-only: it never updates or deletes anything, so booked / locked rows and the
-- 09:00 / 13:00 / 17:00 rows are not touched. The unique (date, start_time) constraint plus
-- ON CONFLICT DO NOTHING makes re-running a no-op.
--
-- Scope: dates from :today_utc through :window_end that already have at least one row.
--   :today_utc  = the UTC date "today" (lib/availability.js todayISO()), e.g. '2026-09-30'
--   :window_end = today_utc + 103 days (lib/availability.js windowEndISO()), e.g. '2027-01-11'
-- Past dates are skipped on purpose.
--
-- Preview (no writes) - how many rows this will insert:
--   select count(*) from (select distinct date from availability
--                          where date between :today_utc and :window_end) d
--   where not exists (select 1 from availability a where a.date = d.date and a.start_time = time '21:00');

insert into availability (date, start_time)
select d.date, time '21:00'
from (
  select distinct date
  from availability
  where date between :'today_utc' and :'window_end'
) d
on conflict (date, start_time) do nothing;
