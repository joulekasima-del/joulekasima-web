-- Still — 1:1 guided meditation venture
-- Single-provider, single-session-type booking system.
-- Forked from Kraft Junction's protocol/patterns, own project, own schema (no shared tenancy).
-- See docs/still/still-venture-decisions.md §6 for the source decisions.
--
-- Model: flat ฿750/session, quantity-based purchases. A purchase of N
-- sessions schedules all N immediately, in the same checkout, before
-- payment. There is no bundle/credits concept — every booking row is
-- directly paid and directly scheduled. Multiple bookings from the same
-- purchase share one stripe_payment_intent_id; that's what ties them
-- together, not a separate grouping table.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- sessions — exactly 1 row: the single session type Still sells.
-- ---------------------------------------------------------------------------
create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  name text not null default '1:1 guided meditation',
  duration_minutes int not null default 30,
  price_per_session_thb int not null default 750,
  max_participants int not null default 1,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- availability — one row per bookable date+time slot.
-- locked_until implements the 15-minute server-enforced hold.
-- ---------------------------------------------------------------------------
create table if not exists availability (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  start_time time not null,
  booked boolean not null default false,
  locked_until timestamptz,
  locked_by text, -- opaque hold token, shared across every slot in one purchase's hold
  created_at timestamptz not null default now(),
  unique (date, start_time)
);

create index if not exists idx_availability_date on availability (date);
create index if not exists idx_availability_open
  on availability (date, start_time)
  where booked = false;

-- ---------------------------------------------------------------------------
-- bookings — one row per session. A purchase of N sessions creates N rows
-- that all share the same stripe_payment_intent_id (one charge covers all
-- N) — that's the only thing tying them together as "the same purchase."
-- ---------------------------------------------------------------------------
create table if not exists bookings (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique, -- ST-XXXXXXXX, one per session
  availability_id uuid references availability (id),

  first_name text not null,
  last_name text not null,
  email text not null,
  phone text,
  notes text,

  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'cancelled_by_participant', 'cancelled_by_provider', 'expired')),

  stripe_payment_intent_id text, -- shared across every booking from the same purchase
  stripe_refund_id text,
  refund_amount_thb int,
  amount_paid_thb int, -- 750 for this one session's share of the purchase

  call_link text,
  calendar_event_id text,
  calendar_sync_failed boolean not null default false,

  hold_token text, -- the same opaque token used to lock the availability row; lets us mark it booked at confirmation time

  reminder_24h_sent boolean not null default false,
  reminder_15m_sent boolean not null default false,
  newsletter_opt_in boolean not null default false,

  cancel_token text not null default rtrim(translate(encode(gen_random_bytes(18), 'base64'), '+/', '-_'), '='),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_bookings_email on bookings (email);
create index if not exists idx_bookings_reference on bookings (reference);
create index if not exists idx_bookings_status on bookings (status);
create index if not exists idx_bookings_payment_intent on bookings (stripe_payment_intent_id);
create index if not exists idx_bookings_needs_attention
  on bookings (calendar_sync_failed)
  where calendar_sync_failed = true;

-- ---------------------------------------------------------------------------
-- email_subscribers — newsletter opt-ins captured at confirmation.
-- ---------------------------------------------------------------------------
create table if not exists email_subscribers (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  source text not null default 'still_booking',
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- updated_at trigger for bookings
-- ---------------------------------------------------------------------------
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_bookings_updated_at on bookings;
create trigger trg_bookings_updated_at
  before update on bookings
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- seed: the single session row
-- ---------------------------------------------------------------------------
insert into sessions (name, duration_minutes, price_per_session_thb, max_participants)
select '1:1 guided meditation', 30, 750, 1
where not exists (select 1 from sessions);
