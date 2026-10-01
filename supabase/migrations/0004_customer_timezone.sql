-- The customer's timezone for display only (IANA name, e.g. America/New_York), recorded when they book.
-- Sessions themselves are still stored as Chiang Mai wall-clock time (availability.date + start_time);
-- this column only controls which timezone confirmation/cancellation emails and the cancel page show.
--
-- Nullable on purpose: existing bookings stay NULL and keep showing Chiang Mai time. The app also works
-- before this runs (it simply doesn't record the timezone and falls back to Chiang Mai time).
-- Safe to re-run.

alter table bookings add column if not exists customer_timezone text;

comment on column bookings.customer_timezone is 'IANA timezone name the customer booked in (display only; validated server-side). NULL = show Chiang Mai time.';
