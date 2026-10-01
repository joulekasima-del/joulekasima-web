const { getSupabase } = require('../../lib/supabase');
const { getStripe } = require('../../lib/stripe');
const { generateBookingReference } = require('../../lib/booking-ref');
const cfg = require('../../lib/config');
const Tz = require('../../assets/timezone');
const { findBlockedSlots } = require('../../lib/blocks');

// PostgREST/Postgres error for a column that doesn't exist yet (migration 0004 not applied).
function isMissingColumnError(err) {
  return !!err && (err.code === 'PGRST204' || err.code === '42703' || /customer_timezone/i.test(String(err.message || '')));
}

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
      currency: requestedCurrency, // optional; validated against the config's allowed list
      customer_timezone: requestedTimezone, // optional IANA zone; display only, never used for price/availability/lead time
    } = req.body || {};
    const customerTimezone = Tz.isValidTimeZone(requestedTimezone) ? requestedTimezone : null;

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
    const stripe = getStripe();
    const nowISO = new Date().toISOString();

    // Every picked slot must still be held by this same client, and not expired.
    const { data: slots, error: slotErr } = await supabase
      .from('availability')
      .select('id, date, start_time, locked_until, locked_by, booked')
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

    // Re-check owner blocks before anything is charged (a block may have been added after the hold was placed).
    if ((await findBlockedSlots(supabase, slots)).length) {
      res.status(409).json({ error: 'One of your chosen times is no longer available. Please pick your times again.' });
      return;
    }

    // A client can only *pick* a currency from the config's allowed list
    // (anything else falls back to the default). The price always comes from
    // still.config.js via lib/config, in minor units — never from the client.
    const currency = cfg.resolveCurrency(requestedCurrency);
    const priceMinor = cfg.priceMinor(currency);
    const totalMinor = priceMinor * availability_ids.length;

    // This hold_token may already have an earlier, unpaid attempt (the buyer
    // switched currency, or went back to details and continued again). A
    // PaymentIntent's currency can't change, so retire the old attempt and
    // replace its pending rows instead of leaving them double-counted.
    // cancel() is the guard: it only succeeds while the PaymentIntent is still
    // unpaid, so a payment that already went through is never replaced.
    const { data: stale, error: staleErr } = await supabase
      .from('bookings')
      .select('id, stripe_payment_intent_id')
      .eq('hold_token', hold_token)
      .eq('status', 'pending');
    if (staleErr) throw staleErr;
    const stalePIs = [...new Set((stale || []).map((b) => b.stripe_payment_intent_id).filter(Boolean))];
    for (const piId of stalePIs) {
      try {
        await stripe.paymentIntents.cancel(piId);
      } catch (cancelErr) {
        const existing = await stripe.paymentIntents.retrieve(piId).catch(() => null);
        if (!existing || existing.status !== 'canceled') {
          res.status(409).json({ error: 'A payment for these sessions is already in progress. Please refresh the page before trying again.' });
          return;
        }
      }
    }
    if (stale && stale.length) {
      const { error: delErr } = await supabase
        .from('bookings')
        .delete()
        .in('id', stale.map((b) => b.id))
        .eq('status', 'pending');
      if (delErr) throw delErr;
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: totalMinor,
      currency: currency.toLowerCase(),
      payment_method_types: ['card'], // cards only (Apple Pay / Google Pay still work through card); no async methods like PromptPay
      receipt_email: email,
      metadata: { quantity: String(availability_ids.length), hold_token, currency },
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
      currency,
      amount_paid_minor: priceMinor, // this one session's share; amount_paid_thb is no longer written
      hold_token,
      newsletter_opt_in: !!newsletter_opt_in,
      ...(customerTimezone ? { customer_timezone: customerTimezone } : {}),
    }));

    let { data: bookings, error: bookingErr } = await supabase
      .from('bookings')
      .insert(bookingsToInsert)
      .select();
    if (bookingErr && customerTimezone && isMissingColumnError(bookingErr)) {
      // Migration 0004 (bookings.customer_timezone) hasn't been applied yet: book without recording the zone.
      ({ data: bookings, error: bookingErr } = await supabase
        .from('bookings')
        .insert(bookingsToInsert.map(({ customer_timezone, ...rest }) => rest))
        .select());
    }
    if (bookingErr) throw bookingErr;

    res.status(200).json({
      client_secret: paymentIntent.client_secret,
      payment_intent_id: paymentIntent.id,
      booking_ids: bookings.map((b) => b.id),
      references: bookings.map((b) => b.reference),
      total_minor: totalMinor,
      currency,
      total_display: cfg.formatMinor(totalMinor, currency),
      quantity: availability_ids.length,
    });
  } catch (err) {
    console.error('still/create-payment-intent error', err);
    res.status(500).json({ error: 'Could not start payment.' });
  }
};
