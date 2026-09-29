const cfg = require('../../lib/config');

// Publishable keys are safe to expose client-side, but since this site has
// no build step to inject env vars into static HTML, the /still/book page
// fetches this small endpoint on load instead of a key being
// hardcoded/committed. It also returns the currency to suggest first, from
// the visitor's country as seen by Vercel (x-vercel-ip-country); the visitor
// can still switch currency on the payment step.
module.exports = async (req, res) => {
  const country = String((req.headers && req.headers['x-vercel-ip-country']) || '').toUpperCase();
  res.setHeader('Cache-Control', 'private, no-store'); // geo-dependent — must never be shared between visitors
  res.status(200).json({
    stripe_publishable_key: process.env.STRIPE_PUBLISHABLE_KEY || null,
    country: country || null,
    suggested_currency: cfg.suggestedCurrency(country),
  });
};
