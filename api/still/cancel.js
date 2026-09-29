const { getSupabase } = require('../../lib/supabase');
const { getStripe } = require('../../lib/stripe');
const { deleteBookingEvent } = require('../../lib/google-calendar');
const { getResend, FROM } = require('../../lib/resend');
const { cancellationEmail } = require('../../lib/emails/templates');
const cfg = require('../../lib/config');
const shared = require('../../assets/shared');
const { bookingAmountMinor, bookingCurrency } = require('../../lib/booking-money');

function hoursUntil(date, startTime) {
  const sessionStart = new Date(`${date}T${startTime}+07:00`);
  return (sessionStart.getTime() - Date.now()) / (1000 * 60 * 60);
}

// Cancels exactly ONE session (one booking row). Uniform cash tiers apply to
// every session, always against its own stored share (amount_paid_minor, in
// the booking's own currency) — refunded as a partial
// Stripe refund against the shared purchase payment_intent. Cancelling one
// session never touches the others from the same purchase.
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    const { reference, token } = req.body || {};
    if (!reference || !token) {
      res.status(400).json({ error: 'reference and token are required' });
      return;
    }

    const supabase = getSupabase();
    const { data: booking, error } = await supabase
      .from('bookings')
      .select('*, availability:availability_id(id, date, start_time)')
      .eq('reference', reference)
      .single();
    if (error || !booking) {
      res.status(404).json({ error: 'Booking not found.' });
      return;
    }
    if (booking.cancel_token !== token) {
      res.status(403).json({ error: 'Invalid cancellation link.' });
      return;
    }
    if (booking.status !== 'confirmed') {
      res.status(409).json({ error: `This booking is already ${booking.status}.` });
      return;
    }

    const hours = hoursUntil(booking.availability.date, booking.availability.start_time);
    // The booking's OWN stored amount and currency — not cfg.currency — so an
    // older THB booking still refunds correctly in THB after the config moves on.
    const paidMinor = bookingAmountMinor(booking);
    const currency = bookingCurrency(booking);
    const pct = shared.refundPercent(hours, cfg.policy);
    const refundMinor = Math.round(paidMinor * pct / 100);

    if (refundMinor > 0 && booking.stripe_payment_intent_id) {
      const stripe = getStripe();
      // No currency param: Stripe refunds in the original PaymentIntent's currency.
      const refund = await stripe.refunds.create({
        payment_intent: booking.stripe_payment_intent_id,
        amount: refundMinor,
      });
      await supabase.from('bookings').update({ stripe_refund_id: refund.id }).eq('id', booking.id);
    }

    await deleteBookingEvent(booking.calendar_event_id);

    await supabase
      .from('availability')
      .update({ booked: false, locked_until: null, locked_by: null })
      .eq('id', booking.availability_id);

    await supabase
      .from('bookings')
      .update({
        status: 'cancelled_by_participant',
        refund_amount_minor: refundMinor,
      })
      .eq('id', booking.id);

    const emailBooking = { ...booking, currency, date: booking.availability.date, start_time: booking.availability.start_time };
    const resend = getResend();
    const template = cancellationEmail(emailBooking, refundMinor);
    await resend.emails.send({ from: FROM, to: booking.email, subject: template.subject, html: template.html }).catch((e) =>
      console.error('Failed to send cancellation email', e)
    );

    res.status(200).json({
      ok: true,
      refund_minor: refundMinor,
      refund_display: refundMinor > 0 ? shared.formatMinor(refundMinor, currency) : null,
    });
  } catch (err) {
    console.error('still/cancel error', err);
    res.status(500).json({ error: 'Could not process cancellation.' });
  }
};
