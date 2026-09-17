# Still — Decisions Log & Implementation Brief

*Everything decided in this session, written to be handed to Claude Code for implementation in `joulekasima-web`. Source files referenced below are in the same delivery as this doc.*

---

## 1. What "Still" is

A new venture under Joule Kasima: 1:1, live, 30-minute guided meditation sessions, delivered over a call. Audience is founders, engineers, and anyone who can't switch off. Tone: plain language, no wellness-industry jargon, short lines — matches the existing Ventures pages.

Status on the homepage: **decided — add it to `#ventures` now, with a `[ live ]` status pill**, matching the homepage's existing pattern (Thai Talk Breaks / Journey Planner / Kraft Junction). Suggested card content and structure are in §6.

---

## 2. Page copy

Source: `meditation-page-copy.md` (user-provided draft). Used as-is, no content changes. Sections, in order:

1. Hero — "Still" / "For people who can't switch off." / CTA
2. The problem, named plainly
3. How it works (3 steps)
4. Who this is for (5-item list, no experience needed)
5. About me (2018 meditation start, 200-hr YTT 2020, Wonderland/Koh Phangan, Chiang Mai base)
6. Session details (30 min, 1:1, pricing — see §5.1)
7. FAQ (4 questions)
8. Closing CTA

---

## 3. Visual design — matched to the live homepage

Pulled directly from `joulekasima.com`'s computed styles (via browser inspection), not invented. Use these tokens verbatim in any component work:

```css
--bg: #F7F6F2;
--bg-panel: #F1EEE6;
--white: #FFFFFF;
--ink: #13161C;
--ink-soft: #5B6069;
--ink-faint: #8B909A;
--line: #DFDCD4;
--accent: #8A5F24;       /* amber/ochre — used for eyebrows, links, status pills */
--accent-bg: #EFE3CD;
--accent-line: #D9C6A0;

--serif: 'Fraunces';     /* headlines */
--sans: 'Inter';         /* body */
--mono: 'JetBrains Mono';/* nav, buttons, labels, badges, eyebrows */
```

Dark-mode equivalents (already implemented in both delivered files):

```css
--bg: #121417; --bg-panel: #191C20; --white: #1B1E22;
--ink: #F2F1EC; --ink-soft: #A9ADB4; --ink-faint: #6C7178;
--line: #2A2D32; --accent: #D2A45C; --accent-bg: #2A2114; --accent-line: #4A3A22;
```

Component conventions carried over from the homepage:
- Buttons: solid ink bg / cream text, mono font, 3px radius, `>` prefix, hover inverts to outline
- Nav links: `[ bracket ]` style, monospace, faint gray, no underline
- Status pills: monospace, small, amber text on tan bg, 2px radius — e.g. `[ in development ]` on the homepage, `[ no experience needed ]` on Still
- Cards/panels: 1px `--line` border, 3px radius, no shadows
- Hairline dividers between list rows and sections instead of bullet icons or card shadows
- Eyebrow line above H1: `> label · label _` in mono amber with a blinking cursor

**Decision:** rejected the first draft's original palette (pine-green accent, different fonts) once the real homepage was inspected — that draft is superseded and not part of this handoff.

---

## 4. Deliverable 1 — the Still landing page

File: `still-meditation-page.html` (self-contained, published as a Claude artifact during this session).

Structure: sticky header (wordmark + `[ ventures ]` link back to homepage + `[ book ]` button) → hero → problem → how it works (numbered 01/02/03, genuine sequence) → who this is for → about → session details panel → FAQ → closing CTA → footer.

CTA behavior: all four "Book a session"/"[ book ]" buttons now point to `/book`, per the decision in §6. The footer's contact email link is untouched. `/book` doesn't resolve to anything yet — that's Claude Code's job — but the landing page itself is no longer pointing at a placeholder.

---

## 5. Pricing — decided (updated)

- **฿750 per session, flat.** No volume discount, no separate "bundle price."
- At checkout, the participant picks a **quantity** (1 or more) in one purchase — not a fixed package size. Total charged = quantity × ฿750.
- The participant picks a day/time for **every session in the purchase**, right there in the same checkout, before paying — not just the first one. All N sessions come out of the purchase already scheduled.
- The quantity picker is shown **before** day/time picking, same principle as before: the participant should know what they're paying for before choosing a slot.
- **This replaces the earlier fixed "5-session bundle at ฿3,000."** Reasoning: the flat discountless rate means every session is worth exactly ฿750 regardless of how many were bought together, which removes an entire category of ambiguity — there's no separate "bundle price" to reconcile against cash refund tiers, and no special case for "what does the bundle's first session cost." Quantity replaces plan as the only purchase-time decision.

---

## 6. Booking protocol — decisions on reusing Kraft Junction's system

Source: `KRAFT_JUNCTION_BOOKING_SYSTEM_REPORT.md` (user-provided). Kraft Junction is a multi-artisan workshop marketplace (Next.js 14, Supabase, Stripe, Resend). Still is a single-provider 1:1 service. Decision: **fork the protocol, don't share the database.** Still should be its own Supabase project / brand, reusing Kraft Junction's *patterns*, not its schema or tenancy.

### Reused as-is
- 3-step flow: Details → Payment → Confirmation, same route shape (`/book/[sessionId]/details|payment|confirmation`)
- **15-minute slot lock** during checkout, auto-release on abandonment or timeout
- **Cancellation tiers**, exact wording:
  > "Full refund 48+ hours before. 50% refund 24–48 hours before. No refund under 24 hours. If I have to cancel, you're always fully refunded."
- **Pricing display pattern**: THB as source of truth, USD/EUR shown alongside
- Resend-based email infrastructure, branded HTML wrapper, reminder cron sent 24 hours and 15 minutes before each session
- Booking reference format, adapted: `ST-XXXXXXXX` (8-char alphanumeric, mirrors Kraft Junction's `KJ-XXXXXXXX`)
- Guest checkout only — no participant accounts

### Adapted
| Kraft Junction | Still |
|---|---|
| Full address revealed after payment | **Call link** revealed after payment instead — auto-generated per booking via Google Calendar (see decision below) |
| `max_participants` variable per workshop | Fixed at 1 — no participant-count field needed |
| 85%/15% artisan/platform split, `payouts` table | **Dropped entirely** — single provider, no split to track |
| Artisan-facing "new booking" email + participant confirmation | Collapses to one internal notification (to you) + one participant confirmation — no separate artisan template set |

### Call link — decided (updated)
**Auto-generated per booking via the Google Calendar API**, not a static room. When a booking is confirmed, the backend creates an event on your Google Calendar for that date/time (using `conferenceDataVersion: 1`), Google generates a unique Meet link for it, and that link gets written back to the booking and used in the confirmation email/page. The event also invites the participant's email directly, so:
- The session shows up on **your** calendar automatically — no manual scheduling step
- The participant gets it on **their** calendar too, if they accept the invite
- Each booking gets its own link, rather than everyone sharing one fixed room

This replaces the earlier "static room" decision — reasoning: convenience for both sides (automatic scheduling on your end, a real calendar invite on theirs) outweighs the extra integration work.

**What this adds, that the static-room version didn't need:**
- A Google Cloud project with the Calendar API enabled
- OAuth credentials for your own Google account, with a refresh token stored securely so the server can create events without you re-authenticating per booking
- A fallback path for when the API call fails at confirmation time — decided below

### Calendar API failure fallback — decided
**Retry, then fall back to a backup static link, then flag for manual follow-up.** If `calendar.events.insert` fails at the moment a booking is confirmed (payment already succeeded), the flow is:
1. Retry the Calendar API call a couple of times (short backoff)
2. If it still fails, use a **backup static meeting link** (a fixed room kept in reserve for exactly this case) as `call_link` on the booking, so the participant still gets something usable in their confirmation
3. Mark the booking with a flag (`calendar_sync_failed = true`) so you can check it manually and, once the calendar's back up, create the real event and swap the link if needed
4. The booking stays `confirmed` throughout — payment already succeeded, so the booking is never rolled back or refunded just because the calendar call failed

This means `bookings` needs one more field beyond what's in the schema below: `calendar_sync_failed` (boolean, default false) alongside `calendar_event_id`, so Claude Code can build a simple "needs attention" view for these.

### Reminder scheduling infrastructure — decided
The site is hosted on **Vercel Hobby**, which only permits cron jobs to run once per day, and even that one run isn't guaranteed to fire at a precise time (±59 min window) — incompatible with a reminder that needs to fire at a specific 24h15m-before mark per session, checked every few minutes.

**Decision: stay on Vercel Hobby (don't upgrade to Pro), and use an external scheduler instead of Vercel's own cron.** Specifically:
- **GitHub Actions**, using its `schedule` trigger (e.g. every 5 minutes), calling the existing reminder API route with a `curl` request carrying a secret bearer token. This needs no new third-party account or signup — the repo already lives on GitHub — and costs nothing at this volume.
- Remove the `crons` entry from `vercel.json` entirely — it would fail to deploy on Hobby regardless, since the schedule needed (every few minutes) exceeds the once-daily limit.
- The reminder route itself doesn't change — it still checks the same 24h/15m windows against `bookings`. Only *what triggers it* changes, from Vercel's own cron to a GitHub Actions workflow hitting the route on a schedule.
- The route must be **secured** (a secret header/bearer token checked before doing anything), since it's now reachable by anyone who finds the URL, not just Vercel's internal cron dispatcher.

If GitHub Actions ever becomes inconvenient, a dedicated free external cron service (cron-job.org or similar) is a drop-in alternative — same pattern, different trigger source.

### Multi-session purchases — decided (updated, supersedes "credits" model)
Buying more than one session at once no longer creates credits to redeem later. Instead: **every session in the purchase gets a day/time picked and confirmed in the same checkout, before payment.** Concretely:
- After choosing a quantity (N), step 1 asks the participant to pick a day and time for **each of the N sessions**, one at a time, right there in the same flow — not just the first one. A running list shows what's been picked so far, with the option to redo any of them before continuing.
- Payment happens once, for the full N × ฿750 total, same as before.
- On confirmation, **all N sessions are created as real, independent bookings**, each getting its own Google Calendar event and Meet link (see below) — the participant walks away with every session already on their calendar, with nothing to come back and redeem.
- This removes the entire credits system: **no `session_credits` table, no expiry, no redemption flow, no `credit_id`.** Every booking, whether it's session 1 of 1 or session 5 of 5, is the same kind of row — directly paid, directly scheduled.
- **Cancellation is now uniform:** every session cancels under the same cash 48h/24h/none tiers, applied to ฿750 per session, refunded as a partial Stripe refund against the shared purchase charge. There's no separate "credit" rule anymore, since nothing is ever redeemed later.
- Multiple bookings from one purchase share the same `stripe_payment_intent_id` (one charge covers all N), which is what ties them together as "the same purchase" — no separate grouping table needed.

### Homepage listing, CTA route, and booking window — decided
- **Homepage:** Still gets added to the `#ventures` section now, status pill `[ live ]`. Suggested card, matching the pattern of the other venture cards (bordered box, serif title, short description, status pill, direct action button rather than a "learn more" link):
  > **Still** — *1:1 guided meditation for people who can't switch off. 30 minutes, live, built around whatever's going on for you that day.* `[ live ]` → `> Book a session`
  The card's button links straight to `/book` (below), skipping an intermediate step, consistent with how Thai Talk Breaks' card acts directly rather than routing through another page first.
- **CTA route:** `/book` — a simple fixed route, not nested under `/still/` and not a dynamic `/book/[sessionId]/...` pattern. This works because Still only has one session type; if a second session type is ever added later, the route can be revisited then rather than over-built now. **The landing page's CTA buttons have been updated to point here** (`still-meditation-page.html` — all four "Book a session"/"[ book ]" links now go to `/book` instead of the `mailto:` placeholder; the footer contact email is untouched).
- **Booking window:** **30 days** ahead. **The prototype has been updated** (`WINDOW_DAYS = 30` in `still-booking-prototype.html`) — the calendar now opens a full month out instead of 14 days.

### Locale routing — decided
**English only for now.** No `/en/` `/th/` prefix, no locale middleware, no `th.json`/`ko.json` translation files. Routes are flat: `/book/[sessionId]/details|payment|confirmation`. Thai can be added later as a genuine `/th/` fork if there's real demand — not worth building preemptively.

### Left out (not needed for Still)
- `reviews` table — optional, could add later for social proof, not core to launch
- Multi-artisan `artisans` table — single hardcoded provider profile instead
- Stripe Connect / marketplace payout logic

### Simplified schema for Still (updated)
```
sessions        — 1 row: "1:1 guided meditation", 30 min, price_per_session_thb (750),
                   max_participants = 1
availability    — date, start_time, locked_until (15-min lock), booked (bool)
bookings        — id, reference (ST-XXXXXXXX), first_name, last_name, email, phone,
                   notes, status (pending/confirmed/cancelled_by_participant/
                   cancelled_by_provider), stripe_payment_intent_id (shared across
                   every booking row created from the same purchase — this is
                   what ties multi-session purchases together, not a separate
                   grouping table), stripe_refund_id, refund_amount_thb,
                   reminder_sent, newsletter_opt_in, call_link (set per booking by
                   the Calendar API response), calendar_event_id (Google Calendar
                   event ID — needed to update/delete the event on cancellation),
                   calendar_sync_failed (boolean, default false — set true if the
                   Calendar API call failed and a backup link was used instead),
                   created_at, updated_at
email_subscribers — newsletter opt-ins captured on confirmation
```
No `payouts`, no `artisans`, no `workshops` (folded into a single `sessions` row), no `plan` field, no `session_credits` table, no `credit_id` (all superseded — see the decision above: every session is booked and paid for directly, in the same checkout, so there's nothing left to track separately as a credit).

---

## 7. Deliverable 2 — clickable booking prototype

File: `still-booking-prototype.html` (front-end only, no real backend — published as a Claude artifact during this session). **Updated for the "schedule everything now" model** — demonstrates the full protocol above in an interactive, no-code-required way:

- Step 1: **quantity selector first** (how many sessions to buy, ฿750 each, live-updating total, per §5), then name/email/phone, then a **repeating day/time picker** — the same full month calendar (30-day window, prev/next navigation) used once per session in the quantity, with a running list showing what's been picked so far and letting the participant redo any of them, until all N are scheduled
- Step 2: live 15-minute hold countdown covering all N reserved slots, THB/USD price block (quantity × ฿750), a summary listing every session's date/time, styled (non-functional) card fields, full cancellation text, unchecked-by-default newsletter opt-in
- Step 3: a generated `ST-XXXXXXXX` reference and its own mock call-link for **each** of the N sessions — nothing left to redeem later — plus a cancellation simulator (uniform cash tiers, since every session is directly paid and directly scheduled now)
- A toggleable **system log** drawer narrates each backend event as it would fire (quantity and slot selection, multi-slot hold, payment intent, N calendar events being created, which emails send, reminder cron) — built as a protocol walkthrough as much as a UI demo

This prototype has **no real Stripe, Supabase, or Resend calls** — it's a state machine in vanilla JS for review purposes only. Nothing here is production code.

---

## 8. Open decisions before real implementation

**None remaining.** Every question raised across this session is now settled:

- Pricing (§5 — ฿750/session flat, quantity-based purchase, no bundle)
- Locale routing (§6 — English-only, flat routes)
- Call link method and its failure fallback (§6 — auto-generated via Google Calendar, retry → backup link → manual flag)
- Reminder scheduling infrastructure (§6 — stay on Vercel Hobby, trigger reminders via a GitHub Actions scheduled workflow instead of Vercel's own cron)
- Multi-session purchases (§6 — every session scheduled and paid for in one checkout, no credits, uniform cancellation tiers)
- Homepage listing, CTA route, and booking window (§6 — `[ live ]` on the homepage, `/book` as the route, 30-day window)

This doc, the landing page, and the prototype are all in sync with these decisions and ready to hand to Claude Code as-is.

---

## 9. File manifest for this handoff

| File | Purpose |
|---|---|
| `still-meditation-page.html` | Final landing page design, matched to joulekasima.com's actual design system, real flat pricing shown |
| `still-booking-prototype.html` | Clickable, front-end-only prototype of the booking flow, quantity selector, and protocol |
| `still-venture-decisions.md` | This document |

None of these are wired to a live backend. Claude Code's job from here: stand up the Supabase schema in §6 (no `session_credits`, no `credit_id`, no `plan` — just `sessions`, `availability`, `bookings` with `calendar_event_id`/`calendar_sync_failed`, and `email_subscribers`), build the real `/book` route following the prototype's UX in §7, where a purchase of N sessions gets all N scheduled in one checkout, wire Stripe against the flat ฿750 price in §5 with a single charge covering the full purchase, wire the Google Calendar API to create one event per session with the retry/fallback logic already decided in §6, wire Resend for the email set, add the Still card to the homepage's `#ventures` section per §6, and confirm the landing page's CTAs (already pointing at `/book`) resolve correctly once that route exists. No open decisions are blocking any of this.
