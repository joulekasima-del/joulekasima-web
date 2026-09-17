const { getSupabase } = require('../../lib/supabase');
const { getStripe } = require('../../lib/stripe');
const { generateBookingReference } = require('../../lib/booking-ref');

const QTY_MAX = 10;

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    const {
      availability_ids, // array of N availability row ids, one per picked session
      hold_token,
      first_name,
      last_name,
      email,
      phone,
      notes,
      newsletter_opt_in,
    } = req.body || {};

    if (!Array.isArray(availability_ids) || availability_ids.length === 0 || availability_ids.length > QTY_MAX) {
      res.status(400).json({ error: `Pick between 1 and ${QTY_MAX} sessions.` });
      return;
    }
    if (!hold_token || !first_name || !last_name || !email) {
      res.status(400).json({ error: 'Missing required booking fields.' });
      return;
    }

    const supabase = getSupabase();
    const nowISO = new Date().toISOString();

    // Every picked slot must still be held by this same client, and not expired.
    const { data: slots, error: slotErr } = await supabase
      .from('availability')
      .select('id, locked_until, locked_by, booked')
      .in('id', availability_ids);
    if (slotErr) throw slotErr;

    const byId = new Map((slots || []).map((s) => [s.id, s]));
    for (const id of availability_ids) {
      const slot = byId.get(id);
      if (!slot || slot.booked || slot.locked_by !== hold_token || !slot.locked_until || slot.locked_until < nowISO) {
        res.status(409).json({ error: 'One of your held slots has expired. Please pick your times again.' });
        return;
      }
    }

    const { data: session } = await supabase.from('sessions').select('*').limit(1).single();
    const pricePerSession = session.price_per_session_thb;
    const totalThb = pricePerSession * availability_ids.length;

    const stripe = getStripe();
    const paymentIntent = await stripe.paymentIntents.create({
      amount: totalThb * 100, // THB minor unit (satang)
      currency: 'thb',
      receipt_email: email,
      metadata: { quantity: String(availability_ids.length), hold_token },
    });

    const bookingsToInsert = availability_ids.map((availability_id) => ({
      reference: generateBookingReference(),
      availability_id,
      first_name,
      last_name,
      email,
      phone: phone || null,
      notes: notes || null,
      status: 'pending',
      stripe_payment_intent_id: paymentIntent.id,
      amount_paid_thb: pricePerSession,
      hold_token,
      newsletter_opt_in: !!newsletter_opt_in,
    }));

    const { data: bookings, error: bookingErr } = await supabase
      .from('bookings')
      .insert(bookingsToInsert)
      .select();
    if (bookingErr) throw bookingErr;

    res.status(200).json({
      client_secret: paymentIntent.client_secret,
      payment_intent_id: paymentIntent.id,
      booking_ids: bookings.map((b) => b.id),
      references: bookings.map((b) => b.reference),
      total_thb: totalThb,
      quantity: availability_ids.length,
    });
  } catch (err) {
    console.error('still/create-payment-intent error', err);
    res.status(500).json({ error: 'Could not start payment.' });
  }
};
