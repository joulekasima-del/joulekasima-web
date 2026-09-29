const crypto = require('crypto');
const { getSupabase } = require('./supabase');
const { markBooked } = require('./availability');
const { createBookingEvent, deleteBookingEvent, BACKUP_CALL_LINK } = require('./google-calendar');
const { getResend, FROM, PROVIDER_EMAIL } = require('./resend');
const {
  bookingConfirmationEmail,
  providerNotificationEmail,
} = require('./emails/templates');
const { bookingAmountMinor, bookingCurrency } = require('./booking-money');

// Confirms a single session's booking row that has already been paid for
// (its purchase's PaymentIntent succeeded). Marks the slot booked and
// creates the Google Calendar event for THIS session only (retry -> backup
// link -> calendar_sync_failed flag, per the decided fallback — never rolls
// the booking back over a calendar failure, and a failure on one session
// never touches the others in the same purchase). Does not send email —
// that happens once per purchase, in finalizePurchase below.
async function finalizeSession(bookingId) {
  const supabase = getSupabase();

  const { data: booking, error: fetchErr } = await supabase
    .from('bookings')
    .select('*, availability:availability_id(date, start_time)')
    .eq('id', bookingId)
    .single();
  if (fetchErr) throw fetchErr;
  if (booking.status === 'confirmed') return booking; // idempotent

  await markBooked({ availabilityId: booking.availability_id, holdToken: booking.hold_token }).catch(() => {
    // The row may already be booked (e.g. webhook retried) — fall through
    // and check current state instead of failing the whole confirmation.
  });

  const { date, start_time } = booking.availability || {};
  const startISO = `${date}T${start_time}+07:00`;
  const endDate = new Date(new Date(startISO).getTime() + 30 * 60 * 1000);

  let call_link = null;
  let calendar_event_id = null;
  let calendar_sync_failed = false;

  try {
    const result = await createBookingEvent({
      summary: `Still — 1:1 guided meditation with ${booking.first_name} ${booking.last_name}`,
      description: booking.notes
        ? `Booking ${booking.reference}. Notes from participant: ${booking.notes}`
        : `Booking ${booking.reference}.`,
      startISO,
      endISO: endDate.toISOString(),
      attendeeEmail: booking.email,
    });
    call_link = result.callLink;
    calendar_event_id = result.eventId;
  } catch (err) {
    console.error('Calendar sync failed for booking', booking.reference, err.message);
    calendar_sync_failed = true;
    call_link = BACKUP_CALL_LINK || 'https://meet.google.com/lookup/still-backup';
  }

  const { data: updated, error: updateErr } = await supabase
    .from('bookings')
    .update({
      status: 'confirmed',
      call_link,
      calendar_event_id,
      calendar_sync_failed,
    })
    .eq('id', bookingId)
    .select('*, availability:availability_id(date, start_time)')
    .single();
  if (updateErr) {
    // The event exists on the calendar but the booking row didn't record it. The
    // claim is about to be released and this session retried, which would create
    // a second event — so remove this one first (best effort).
    if (calendar_event_id) {
      await deleteBookingEvent(calendar_event_id).catch((e) => console.error('finalize: could not remove orphaned calendar event', calendar_event_id, e.message));
    }
    throw updateErr;
  }

  if (updated.newsletter_opt_in) {
    await supabase
      .from('email_subscribers')
      .upsert({ email: updated.email, source: 'still_booking' }, { onConflict: 'email', ignoreDuplicates: true });
  }

  return updated;
}

// ---------------------------------------------------------------------------
// Atomic claim (fixes the finalize / webhook race)
//
// /api/still/finalize (called by the browser) and the payment_intent.succeeded
// webhook both call finalizePurchase() for the same PaymentIntent, usually within
// a second of each other. Reading status='pending' and then acting is a
// check-then-act race: both callers used to pass the check and each created a
// calendar event and sent the emails.
//
// Now a caller must first CLAIM the purchase's pending rows with one conditional
// UPDATE. Postgres re-checks the WHERE clause against the row's latest committed
// version, so of any number of simultaneous callers exactly one gets rows back
// and proceeds; the rest do no side effects.
//
// The claim marker lives in bookings.call_link ('finalizing:<claim id>'), NOT in
// a new status: bookings.status has a CHECK constraint that would reject a new
// value, and changing it needs a migration. call_link is always null on a
// pending row and every reader (reminder cron, emails, /finalize response) only
// looks at it on confirmed rows, where finalizeSession() overwrites it with the
// real call link.
// ---------------------------------------------------------------------------
const CLAIM_PREFIX = 'finalizing:';
// A claim older than this (by updated_at, which a DB trigger bumps on every
// write) is treated as abandoned — e.g. the function was killed mid-way — and
// can be re-claimed so the booking is never stuck.
const CLAIM_STALE_MS = 30 * 1000;
// How long a /finalize caller that lost the claim waits for the winner to finish
// (it needs the confirmed rows to build its response). Kept under Vercel's 10s
// function limit.
const WAIT_FOR_WINNER_MS = 8 * 1000;
const POLL_MS = 300;

const BOOKING_SELECT = '*, availability:availability_id(date, start_time)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function loadPurchase(paymentIntentId) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('bookings')
    .select(BOOKING_SELECT)
    .eq('stripe_payment_intent_id', paymentIntentId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

// One atomic UPDATE. Returns the ids this caller now owns (empty = someone else does).
async function claimPending(paymentIntentId, claimMarker) {
  const supabase = getSupabase();
  const staleISO = new Date(Date.now() - CLAIM_STALE_MS).toISOString();
  const { data, error } = await supabase
    .from('bookings')
    .update({ call_link: claimMarker })
    .eq('stripe_payment_intent_id', paymentIntentId)
    .eq('status', 'pending')
    .or(`call_link.is.null,and(call_link.like.${CLAIM_PREFIX}*,updated_at.lt.${staleISO})`)
    .select('id');
  if (error) throw error;
  return (data || []).map((r) => r.id);
}

// Give the rows we claimed but did not finish back, so a retry (Stripe re-sends
// the webhook on a non-2xx; the browser can call /finalize again) can complete
// them. Rows already confirmed are untouched (their call_link is the real link).
async function releaseClaim(paymentIntentId, claimMarker) {
  const supabase = getSupabase();
  const { error } = await supabase
    .from('bookings')
    .update({ call_link: null })
    .eq('stripe_payment_intent_id', paymentIntentId)
    .eq('status', 'pending')
    .eq('call_link', claimMarker);
  if (error) console.error('finalize: could not release claim for', paymentIntentId, error.message);
}

// Confirms every booking row created from one purchase (same
// stripe_payment_intent_id) and sends ONE confirmation email listing all of
// them, plus one provider notification — exactly once, however many callers
// run at the same time (see the claim above).
//
// A caller that loses the claim does no side effects itself: it waits (up to
// WAIT_FOR_WINNER_MS) for the winner to finish and returns the confirmed rows
// (the browser needs them). If the winner hasn't finished by then it throws, so
// the webhook answers non-2xx and Stripe retries, rather than 200-ing a purchase
// that may still be unconfirmed.
async function finalizePurchase(paymentIntentId) {
  const existing = await loadPurchase(paymentIntentId);
  if (existing.length === 0) {
    throw new Error(`No bookings found for payment_intent ${paymentIntentId}`);
  }
  if (!existing.some((b) => b.status === 'pending')) {
    return existing; // already fully confirmed — nothing new to do or email
  }

  const claimMarker = `${CLAIM_PREFIX}${crypto.randomUUID()}`;
  const deadline = Date.now() + WAIT_FOR_WINNER_MS;
  let claimed = await claimPending(paymentIntentId, claimMarker);

  while (claimed.length === 0) {
    // Lost the claim: another caller is (or was) finalizing this purchase.
    const rows = await loadPurchase(paymentIntentId);
    if (!rows.some((b) => b.status === 'pending')) return rows; // the winner finished
    if (Date.now() >= deadline) throw new Error(`Still being confirmed by another request (payment_intent ${paymentIntentId})`);
    await sleep(POLL_MS);
    // If the winner died, its claim goes stale and this attempt can take over.
    claimed = await claimPending(paymentIntentId, claimMarker);
  }

  try {
    for (const id of claimed) {
      await finalizeSession(id);
    }
  } catch (err) {
    await releaseClaim(paymentIntentId, claimMarker); // don't leave rows stuck mid-claim
    throw err;
  }

  // Reload the whole purchase (not just what this attempt claimed) so a retry
  // after a partial failure still emails every session.
  const bookings = await loadPurchase(paymentIntentId);
  try {
    await sendPurchaseEmails(bookings);
  } catch (err) {
    // Everything is confirmed and on the calendar; a template/email problem must
    // not turn a successful booking into an error the caller retries forever.
    console.error('finalize: confirmation email step failed for', paymentIntentId, err);
  }
  return bookings;
}

async function sendPurchaseEmails(bookings) {
  const resend = getResend();
  const first = bookings[0];
  const sessions = bookings.map((b) => ({
    reference: b.reference,
    date: b.availability?.date,
    start_time: b.availability?.start_time,
    call_link: b.call_link,
    calendar_sync_failed: b.calendar_sync_failed,
    cancel_token: b.cancel_token,
  }));

  const purchase = {
    first_name: first.first_name,
    last_name: first.last_name,
    email: first.email,
    phone: first.phone,
    notes: first.notes,
    total_paid_minor: bookings.reduce((sum, b) => sum + bookingAmountMinor(b), 0),
    currency: bookingCurrency(first), // one purchase = one PaymentIntent = one currency
    sessions,
  };

  const confirmation = bookingConfirmationEmail(purchase);
  const notification = providerNotificationEmail(purchase);

  await Promise.allSettled([
    resend.emails.send({ from: FROM, to: purchase.email, subject: confirmation.subject, html: confirmation.html }),
    resend.emails.send({ from: FROM, to: PROVIDER_EMAIL, subject: notification.subject, html: notification.html }),
  ]);
}

module.exports = { finalizeSession, finalizePurchase };
