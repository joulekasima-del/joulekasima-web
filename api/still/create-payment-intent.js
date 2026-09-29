const { getSupabase } = require('../../lib/supabase');
const { getStripe } = require('../../lib/stripe');
const { generateBookingReference } = require('../../lib/booking-ref');
const cfg = require('../../lib/config');

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

    if (!Array.isArray(availability_ids) || availability_ids.length === 0 || availability_ids.length > cfg.maxPerPurchase) {
      res.status(400).json({ error: `Pick between 1 and ${cfg.maxPerPurchase} sessions.` });
      return;
    }
    if (new Set(availability_ids).size !== availability_ids.length) {
      res.status(400).json({ error: 'Each session must be a different time slot.' });
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

    // Price and currency come from still.config.js (via lib/config), in minor
    // units — never from the client.
    const priceMinor = cfg.priceMinor;
    const totalMinor = priceMinor * availability_ids.length;

    const stripe = getStripe();
    const paymentIntent = await stripe.paymentIntents.create({
      amount: totalMinor,
      currency: cfg.currency.toLowerCase(),
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
      currency: cfg.currency,
      amount_paid_minor: priceMinor, // this one session's share; amount_paid_thb is no longer written
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
      total_minor: totalMinor,
      total_display: cfg.formatMinor(totalMinor),
      quantity: availability_ids.length,
    });
  } catch (err) {
    console.error('still/create-payment-intent error', err);
    res.status(500).json({ error: 'Could not start payment.' });
  }
};
