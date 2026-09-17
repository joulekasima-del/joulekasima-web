const { getSupabase } = require('./supabase');
const { markBooked } = require('./availability');
const { createBookingEvent, BACKUP_CALL_LINK } = require('./google-calendar');
const { getResend, FROM, PROVIDER_EMAIL } = require('./resend');
const {
  bookingConfirmationEmail,
  providerNotificationEmail,
} = require('./emails/templates');

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
  if (updateErr) throw updateErr;

  if (updated.newsletter_opt_in) {
    await supabase
      .from('email_subscribers')
      .upsert({ email: updated.email, source: 'still_booking' }, { onConflict: 'email', ignoreDuplicates: true });
  }

  return updated;
}

// Confirms every booking row created from one purchase (same
// stripe_payment_intent_id) and sends ONE confirmation email listing all of
// them, plus one provider notification. Idempotent: if every booking in the
// purchase is already confirmed when this runs, it's a no-op (so a webhook
// retry after the client's own finalize call doesn't double-email).
async function finalizePurchase(paymentIntentId) {
  const supabase = getSupabase();

  const { data: bookings, error } = await supabase
    .from('bookings')
    .select('*, availability:availability_id(date, start_time)')
    .eq('stripe_payment_intent_id', paymentIntentId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  if (!bookings || bookings.length === 0) {
    throw new Error(`No bookings found for payment_intent ${paymentIntentId}`);
  }

  const hadPending = bookings.some((b) => b.status === 'pending');
  if (!hadPending) {
    return bookings; // already fully confirmed — nothing new to do or email
  }

  const confirmed = [];
  for (const booking of bookings) {
    confirmed.push(await finalizeSession(booking.id));
  }

  await sendPurchaseEmails(confirmed);

  return confirmed;
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
    total_paid_thb: bookings.reduce((sum, b) => sum + (b.amount_paid_thb || 0), 0),
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
