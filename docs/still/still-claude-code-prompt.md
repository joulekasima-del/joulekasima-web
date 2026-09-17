# Master prompt — Still booking system implementation

*Paste this into a new Claude Code session, opened inside the `joulekasima-web` repo, with the three files below attached or copied into the repo (e.g. under `docs/still/`).*

---

## Context

I'm adding a new venture, **Still** (1:1 guided meditation, 30 minutes, live over a call), to my site. All product, pricing, and policy decisions have already been made in a separate planning session — they're final. Your job in this session is **implementation only**. Do not re-litigate or second-guess any decision below; if something genuinely can't be built as specified, stop and ask rather than silently choosing something else.

Three reference files are attached:
1. **`still-venture-decisions.md`** — the full decisions log. Read this first, completely, before writing any code. It has the settled pricing, the Supabase schema, the Google Calendar integration approach and its failure fallback, the bundle-credit rules, the homepage listing copy, the CTA route, and the booking window. Nothing in here is still open — treat every "decided" line as a spec, not a suggestion.
2. **`still-meditation-page.html`** — the finished landing page design, already matched to this site's actual design system (Fraunces/Inter/JetBrains Mono, the amber/ink/cream palette, the bracket-nav and mono-button conventions). Its four CTA buttons already point at `/book`. Port this into the site's existing templating system rather than serving it as a standalone static file, and make sure it still matches the homepage exactly once it's integrated.
3. **`still-booking-prototype.html`** — a clickable, front-end-only prototype of the entire booking flow (no real backend, just a JS state machine). This is the **UX spec** for the real `/book` route — build the real thing to behave exactly like this: the plan selector, the month calendar, the 15-minute slot hold with live countdown, the price block, the cancellation-tier simulator's logic (even though the real cancellation flow is a proper page, not a simulator), and the confirmation screen's layout. Open it and click through both the single-session and bundle paths before you start building, so you're not guessing at behavior that's already been designed.

---

## Build order

Work through these in order — each one depends on the last:

### 1. Supabase schema
Stand up the schema exactly as specified in `still-venture-decisions.md` §6:
- `sessions` (1 row — the single session type, with `price_single_thb` and `price_bundle_thb`)
- `availability`
- `bookings` — including `plan`, `call_link`, `calendar_event_id`, `calendar_sync_failed`, and `credit_id`
- `session_credits` — including `expires_at` set to purchase + 6 months
- `email_subscribers`

No `payouts`, `artisans`, or multi-workshop tables — this is a single-provider, single-session-type system, not a marketplace.

### 2. The `/book` route
Build it as a fixed route (not `/book/[sessionId]/...` — there's only one session type, so don't add a dynamic segment for it). Three steps, matching the prototype:
- **Step 1:** plan selector (single ฿750 / bundle ฿3,000) shown *before* the calendar, then details, then a real month calendar with a 30-day booking window, then time slots
- **Step 2:** the 15-minute slot lock (server-enforced, not just a UI countdown — the lock needs to actually reserve the slot in `availability`), Stripe Elements for payment, the real cancellation policy text
- **Step 3:** confirmation, with the Google Calendar–generated call link (see §4 below), and bundle bookings showing sessions-remaining

### 3. Credit redemption
Someone with remaining bundle credits should be able to book a future session through the **same flow**, just skipping the payment step (per the decision in §6) — figure out the entry point for this (e.g. a link in their confirmation email, or a lookup-by-email step) and keep it consistent with the rest of the flow rather than building a separate shortcut UI.

### 4. Google Calendar integration
On booking confirmation, call the Calendar API (`conferenceDataVersion: 1`) to create an event on my calendar, invite the participant's email, and get back a Meet link. Store it as `call_link` and the event ID as `calendar_event_id`. Implement the failure fallback exactly as decided: retry a couple of times, then fall back to a backup static link, set `calendar_sync_failed = true`, and keep the booking `confirmed` regardless — never roll back or refund a booking just because the calendar call failed.

You'll need me to set up a Google Cloud project, enable the Calendar API, and generate OAuth credentials + a refresh token — flag this as something you need from me rather than trying to work around it.

### 5. Cancellation
Two real flows, both server-side:
- Cash (single-session) cancellations: the standard 48h/24h tiers, with a real Stripe refund
- Credit-redeemed session cancellations: the 24h binary rule — 24h+ notice restores the credit (decrement `credits_used`), under 24h forfeits it, no cash refund involved

### 6. Emails (Resend)
Build the adapted set from §6/§7 of the decisions doc: booking confirmation to the participant, a notification to me, the 24h-before reminder (cron), and cancellation confirmations for both the cash and credit paths. Reuse the site's existing branded email wrapper if there is one; otherwise keep it simple and consistent with the landing page's visual identity.

### 7. Homepage listing
Add the Still card to the `#ventures` section, `[ live ]` status pill, using the suggested copy in §6 of the decisions doc. Match the existing card pattern exactly (bordered box, serif title, short description, status pill, direct action button) — don't invent a new card style.

### 8. Wire it all together
Confirm the landing page's four CTA buttons resolve correctly to the real `/book` route now that it exists.

---

## What I'll need to provide

Flag these clearly if you hit them and don't have them yet — don't stub around missing credentials silently:
- Stripe secret/publishable keys (test mode to start)
- Google Cloud OAuth credentials + refresh token for the Calendar API
- Resend API key
- Supabase project URL + keys (if not already in the repo's env)

## What "done" looks like

A real booking — single or bundle — goes from the landing page, through `/book`, through a real Stripe charge (test mode), to a real Supabase row, a real Google Calendar event with a real Meet link, and a real confirmation email, with the 15-minute hold actually preventing double-booking and the cancellation flows actually working for both cash and credit bookings. Walk me through a full test booking once it's wired, before we talk about going live.
