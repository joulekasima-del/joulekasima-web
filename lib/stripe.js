const Stripe = require('stripe');

let client = null;

function getStripe() {
  if (client) return client;

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error('Missing STRIPE_SECRET_KEY env var — Still payments cannot run without it.');
  }

  client = new Stripe(key, { apiVersion: '2024-06-20' });
  return client;
}

module.exports = { getStripe };
