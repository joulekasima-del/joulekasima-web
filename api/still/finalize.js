const { getStripe } = require('../../lib/stripe');
const { finalizePurchase } = require('../../lib/finalize-booking');
const shared = require('../../assets/shared');
const { bookingAmountMinor, bookingCurrency } = require('../../lib/booking-money');

// Called by the client right after stripe.confirmPayment() resolves, so the
// participant sees their confirmation instantly instead of waiting on the
// webhook round-trip. Verifies the PaymentIntent status server-side first —
// never trusts the client's word that payment succeeded. The Stripe webhook
// (webhook-stripe.js) still runs finalizePurchase() as the reliable backstop
// for cases where the browser closes before this call fires; both paths are
// idempotent.
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    const { payment_intent_id } = req.body || {};
    if (!payment_intent_id) {
      res.status(400).json({ error: 'payment_intent_id is required' });
      return;
    }

    const stripe = getStripe();
    const pi = await stripe.paymentIntents.retrieve(payment_intent_id);
    if (pi.status !== 'succeeded') {
      res.status(409).json({ error: 'Payment has not succeeded yet.' });
      return;
    }

    const confirmed = await finalizePurchase(payment_intent_id);
    const first = confirmed[0];
    // One purchase = one PaymentIntent = one currency. If that ever isn't
    // true, log it and format in the first booking's currency.
    const currency = bookingCurrency(first);
    if (confirmed.some((b) => bookingCurrency(b) !== currency)) {
      console.warn('still/finalize: mixed currencies in one purchase', payment_intent_id);
    }
    const totalMinor = confirmed.reduce((sum, b) => sum + bookingAmountMinor(b), 0);
    res.status(200).json({
      ok: true,
      first_name: first.first_name,
      last_name: first.last_name,
      email: first.email,
      total_paid_minor: totalMinor,
      total_paid_display: shared.formatMinor(totalMinor, currency),
      sessions: confirmed.map((b) => ({
        reference: b.reference,
        call_link: b.call_link,
        date: b.availability.date,
        start_time: b.availability.start_time,
        cancel_token: b.cancel_token,
      })),
    });
  } catch (err) {
    console.error('still/finalize error', err);
    res.status(500).json({ error: 'Could not finalize booking.' });
  }
};
