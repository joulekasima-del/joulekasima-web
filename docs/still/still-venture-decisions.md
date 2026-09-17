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

## 5. Pricing — decided

- **Single session:** ฿750
- **5-session bundle:** ฿3,000 (฿600/session — saves ฿750 vs. buying five singles)
- The bundle pays for **one session immediately** (the buyer picks a day/time as normal) **plus 4 credits** redeemable for future sessions without paying again.
- Both options are shown **before** the participant picks a day/time, so they choose their slot already knowing what they're paying for — this is now built into the booking prototype (§6) as a plan-selector at the top of the details step.
- This replaces the vague "ask about an intro rate" copy that was on the landing page's session-details panel; that row now shows the real bundle price instead. The landing page has been updated to match.

**New open question this creates** (see §8): the bundle introduces a credits/redemption model that Kraft Junction's protocol doesn't have at all — it needs its own policy decisions before Claude Code builds it for real.

---

## 6. Booking protocol — decisions on reusing Kraft Junction's system

Source: `KRAFT_JUNCTION_BOOKING_SYSTEM_REPORT.md` (user-provided). Kraft Junction is a multi-artisan workshop marketplace (Next.js 14, Supabase, Stripe, Resend). Still is a single-provider 1:1 service. Decision: **fork the protocol, don't share the database.** Still should be its own Supabase project / brand, reusing Kraft Junction's *patterns*, not its schema or tenancy.

### Reused as-is
- 3-step flow: Details → Payment → Confirmation, same route shape (`/book/[sessionId]/details|payment|confirmation`)
- **15-minute slot lock** during checkout, auto-release on abandonment or timeout
- **Cancellation tiers**, exact wording:
  > "Full refund 48+ hours before. 50% refund 24–48 hours before. No refund under 24 hours. If I have to cancel, you're always fully refunded."
- **Pricing display pattern**: THB as source of truth, USD/EUR shown alongside
- Resend-based email infrastructure, branded HTML wrapper, 24-hour-before reminder cron
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

### Bundle credits — decided
The three questions the bundle (§5) raised are now settled:
- **Expiry:** credits expire **6 months** from the bundle purchase date. `session_credits.expires_at` = `purchased_at` + 6 months, set at purchase time.
- **Cancellation on a credit-redeemed session:** **24h+ notice → the credit returns** to the balance (`credits_used` decrements, so it's usable again); **under 24h → the credit is forfeited** (`credits_used` stays as-is). This mirrors the cash cancellation tiers' spirit but collapses to a single 24-hour line since a credit can't be partially refunded the way cash can — there's no 50%-of-a-credit.
- **Redemption flow:** redeeming a credit goes through the **same details → day/time flow** as a fresh booking, just **skipping the payment step** (no card fields, no price block) since it's already paid for. Keeps the UX consistent rather than building a separate shortcut path — one flow to maintain instead of two.

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

### Simplified schema for Still (decision, not yet built)
```
sessions        — 1 row: "1:1 guided meditation", 30 min, price_single_thb (750),
                   price_bundle_thb (3000), max_participants = 1
availability    — date, start_time, locked_until (15-min lock), booked (bool)
bookings        — id, reference (ST-XXXXXXXX), plan (single/bundle), first_name,
                   last_name, email, phone, notes, status (pending/confirmed/
                   cancelled_by_participant/cancelled_by_provider),
                   stripe_payment_intent_id, stripe_refund_id, refund_amount_thb,
                   reminder_sent, newsletter_opt_in, call_link (set per booking by
                   the Calendar API response), calendar_event_id (Google Calendar
                   event ID — needed to update/delete the event on cancellation),
                   calendar_sync_failed (boolean, default false — set true if the
                   Calendar API call failed and a backup link was used instead),
                   credit_id (FK → session_credits, nullable — set when a bundle
                   credit is redeemed rather than paid for directly), created_at,
                   updated_at
session_credits — id, email, total_credits (5), credits_used, purchased_at,
                   stripe_payment_intent_id, expires_at (purchased_at + 6 months)
email_subscribers — newsletter opt-ins captured on confirmation
```
No `payouts`, no `artisans`, no `workshops` (folded into a single `sessions` row).

---

## 7. Deliverable 2 — clickable booking prototype

File: `still-booking-prototype.html` (front-end only, no real backend — published as a Claude artifact during this session). Demonstrates the full protocol above in an interactive, no-code-required way:

- Step 1: **plan selector first** (single ฿750 vs. 5-session bundle ฿3,000, shown before day/time so the participant picks their slot already knowing what they're paying for — per the pricing decision in §5), then name/email/phone, a **full month calendar** (prev/next navigation, past dates greyed, dates beyond the open booking window greyed as "not yet open," available dates marked with a dot) for picking the day, a time grid below it once a day's selected (some slots pre-marked taken/past to simulate real availability), optional context notes
- Step 2: live 15-minute hold countdown, THB/USD price block that reflects the chosen plan, styled (non-functional) card fields, full cancellation text, unchecked-by-default newsletter opt-in
- Step 3: generated `ST-XXXXXXXX` reference, mock call-link reveal, plan-aware confirmation (shows "4 of 5 sessions remaining" for bundle bookings), interactive cancellation-tier simulator (60h / 30h / 10h scenarios)
- A toggleable **system log** drawer narrates each backend event as it would fire (plan selection, slot lock, payment intent, status transitions, `session_credits` row creation for bundles, which emails send, reminder cron) — built as a protocol walkthrough as much as a UI demo

This prototype has **no real Stripe, Supabase, or Resend calls** — it's a state machine in vanilla JS for review purposes only. Nothing here is production code.

---

## 8. Open decisions before real implementation

**None remaining.** Every question raised across this session is now settled:

- Pricing (§5 — ฿750 single / ฿3,000 bundle)
- Locale routing (§6 — English-only, flat routes)
- Call link method and its failure fallback (§6 — auto-generated via Google Calendar, retry → backup link → manual flag)
- All three bundle-credit questions (§6 — 6-month expiry, 24h cancellation line, same-flow redemption)
- Homepage listing, CTA route, and booking window (§6 — `[ live ]` on the homepage, `/book` as the route, 30-day window)

This doc, the landing page, and the prototype are all in sync with these decisions and ready to hand to Claude Code as-is.

---

## 9. File manifest for this handoff

| File | Purpose |
|---|---|
| `still-meditation-page.html` | Final landing page design, matched to joulekasima.com's actual design system, real pricing shown |
| `still-booking-prototype.html` | Clickable, front-end-only prototype of the booking flow, plan selector, and protocol |
| `still-venture-decisions.md` | This document |

None of these are wired to a live backend. Claude Code's job from here: stand up the Supabase schema in §6 (including `session_credits` with its 6-month expiry, and `calendar_event_id`/`calendar_sync_failed` on `bookings`), build the real `/book` route following the prototype's UX in §7 and the credit-redemption behavior decided in §6, wire Stripe against the decided prices in §5, wire the Google Calendar API for call-link generation with the retry/fallback logic already decided in §6, wire Resend for the email set, add the Still card to the homepage's `#ventures` section per §6, and confirm the landing page's CTAs (already pointing at `/book`) resolve correctly once that route exists. No open decisions are blocking any of this.
