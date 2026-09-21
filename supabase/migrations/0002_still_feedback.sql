-- Still — post-session feedback / testimonials
-- See docs/still/still-venture-decisions.md for the source decisions on the
-- rest of the schema; this is an additive migration, no existing tables or
-- columns are changed except the one new flag on bookings noted below.
--
-- Flow: ~24h after a confirmed session, the reminder cron (cron-reminder.js)
-- also sends a low-pressure feedback-invite email with a link to
-- /still/feedback?ref=<reference>. The form asks for a name, an optional
-- photo, and a message. Nothing is shown publicly unless the person
-- explicitly checks "okay to share this publicly" — consent_public defaults
-- to false. Even then, nothing is auto-published: `featured` is a manual
-- flag the provider sets (via the Supabase dashboard) to promote a specific
-- submission onto the Still page later.

alter table bookings add column if not exists feedback_email_sent boolean not null default false;

create table if not exists session_feedback (
  id uuid primary key default gen_random_uuid(),
  booking_reference text, -- the ST-XXXXXXXX this feedback is about, if it came from a session-invite link. Not a hard FK — the form works even without one.
  name text not null,
  message text not null,
  photo_url text, -- public URL in the feedback-photos storage bucket, if a photo was attached
  consent_public boolean not null default false, -- opt-in only: true means the submitter agreed their name/photo/message could be shown publicly
  featured boolean not null default false, -- manually set by the provider to promote this into a testimonials section later
  created_at timestamptz not null default now()
);

create index if not exists idx_session_feedback_booking_reference on session_feedback (booking_reference);
create index if not exists idx_session_feedback_featured on session_feedback (featured) where featured = true;

-- Storage bucket for optional feedback photos. Uploads happen server-side
-- only (api/still/feedback.js, via the service-role client), so this bucket
-- never needs a client-facing write policy. It's marked public so a stored
-- photo_url resolves to a directly-loadable image if a testimonial is later
-- shown on the Still page.
insert into storage.buckets (id, name, public)
values ('feedback-photos', 'feedback-photos', true)
on conflict (id) do nothing;
