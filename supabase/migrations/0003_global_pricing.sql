-- Additive only: adds new columns alongside the existing *_thb ones.
-- The existing THB checkout code is completely unaffected by this migration.

alter table bookings add column if not exists currency text;
alter table bookings add column if not exists amount_paid_minor int;
alter table bookings add column if not exists refund_amount_minor int;

-- Backfill existing rows: whole baht -> satang (THB is a 100x currency).
-- Existing bookings were charged in THB, so currency is set to THB regardless
-- of whatever the config's currency is by the time this runs.
-- Idempotent: safe to re-run (the post-deploy re-run in the later stage picks
-- up any rows the still-THB code inserted between this migration and the
-- deploy of the new code).
update bookings
   set currency = coalesce(currency, 'THB'),
       amount_paid_minor = coalesce(amount_paid_minor, amount_paid_thb * 100),
       refund_amount_minor = coalesce(refund_amount_minor, refund_amount_thb * 100)
 where amount_paid_minor is null
    or currency is null
    or (refund_amount_minor is null and refund_amount_thb is not null);

-- NOT NULL is deliberately NOT set here. The live checkout (create-payment-intent.js)
-- inserts bookings without a currency until the new code ships, so a NOT NULL
-- constraint now would make every live booking insert fail. Instead, default
-- new rows to 'THB' — which is exactly what the unmodified code charges in.
-- A later migration (after the new code is live and verified) re-runs the
-- backfill above, then does:
--     alter table bookings alter column currency set not null;
--     alter table bookings alter column currency drop default;
alter table bookings alter column currency set default 'THB';

-- ---------------------------------------------------------------------------
-- VERIFICATION (read-only) — run AFTER this migration is applied, not before.
-- Every count below should be 0. `total_rows` should equal the bookings count.
-- ---------------------------------------------------------------------------
-- select
--   count(*)                                                          as total_rows,
--   count(*) filter (where currency is distinct from 'THB')           as not_thb,
--   count(*) filter (where amount_paid_minor is distinct from amount_paid_thb * 100)
--                                                                     as paid_mismatch,
--   count(*) filter (where refund_amount_minor is distinct from refund_amount_thb * 100)
--                                                                     as refund_mismatch
-- from bookings;
--
-- (`is distinct from` treats NULL = NULL as a match, so rows with a null
-- refund_amount_thb correctly compare equal to a null refund_amount_minor.)
