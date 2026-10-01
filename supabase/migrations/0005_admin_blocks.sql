-- Admin "blocked times": days or slots the owner has closed. Kept in a SEPARATE table on purpose, so a block is
-- independent of lazily generated availability rows (deleting/regenerating them can't undo it), is never confused
-- with a real booking, and never touches existing bookings.
--
-- Run once in the Supabase SQL editor. Additive only; safe to re-run. The app also works before this runs:
-- public booking behaves exactly as before and the admin page shows a "run migration" notice.

create table if not exists availability_blocks (
  id uuid primary key default gen_random_uuid(),
  date date not null,                 -- Chiang Mai calendar date (same as availability.date)
  start_time time,                    -- NULL = the whole day; otherwise one slot, e.g. 21:00
  reason text,                        -- private note for the owner; never shown publicly
  created_at timestamptz not null default now(),
  constraint availability_blocks_reason_len check (reason is null or char_length(reason) <= 200)
);

-- One whole-day block per date, and one block per (date, slot). Two partial indexes keep NULL = "whole day" unambiguous.
create unique index if not exists availability_blocks_whole_day_key on availability_blocks (date) where start_time is null;
create unique index if not exists availability_blocks_slot_key on availability_blocks (date, start_time) where start_time is not null;
create index if not exists availability_blocks_date_idx on availability_blocks (date);

-- Log of every change made from the admin page.
create table if not exists admin_actions (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  action text not null,               -- e.g. block_add, block_remove
  payload jsonb
);
create index if not exists admin_actions_at_idx on admin_actions (at desc);

-- Service role only: RLS on, NO policies, and no direct grants to the public API roles.
alter table availability_blocks enable row level security;
alter table admin_actions enable row level security;
revoke all on table availability_blocks from anon, authenticated;
revoke all on table admin_actions from anon, authenticated;
