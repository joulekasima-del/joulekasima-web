const { getStripe } = require('../../lib/stripe');
const { finalizePurchase } = require('../../lib/finalize-booking');

// Stripe needs the raw request body to verify the webhook signature.
module.exports.config = { api: { bodyParser: false } };

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const stripe = getStripe();
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error('Missing STRIPE_WEBHOOK_SECRET');
    res.status(500).json({ error: 'Webhook not configured.' });
    return;
  }

  let event;
  try {
    const rawBody = await readRawBody(req);
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    console.error('Stripe webhook signature verification failed', err.message);
    res.status(400).send(`Webhook Error: ${err.message}`);
    return;
  }

  try {
    if (event.type === 'payment_intent.succeeded') {
      const pi = event.data.object;
      try {
        await finalizePurchase(pi.id);
      } catch (err) {
        if (err.message && err.message.startsWith('No bookings found')) {
          console.error(err.message);
          res.status(200).json({ received: true }); // ack so Stripe stops retrying; nothing to reconcile
          return;
        }
        throw err;
      }
    }

    res.status(200).json({ received: true });
  } catch (err) {
    console.error('still/webhook-stripe error', err);
    res.status(500).json({ error: 'Webhook handling failed.' });
  }
};
