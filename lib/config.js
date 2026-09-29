const CFG = require('../still.config.js');
const shared = require('../assets/shared.js');

function requireNumber(v, path) {
  const n = Number(v);
  if (!isFinite(n) || n <= 0) throw new Error(`still.config.js: set ${path} to a positive number (got ${JSON.stringify(v)}).`);
  return n;
}

function currencies() {
  const list = Object.keys(CFG.session.prices || {}).map((c) => c.toUpperCase());
  if (!list.length) throw new Error('still.config.js: session.prices must list at least one currency.');
  return list;
}

function defaultCurrency() {
  const d = String(CFG.session.defaultCurrency || '').toUpperCase();
  if (!currencies().includes(d)) throw new Error(`still.config.js: session.defaultCurrency (${JSON.stringify(CFG.session.defaultCurrency)}) must be one of session.prices.`);
  return d;
}

// Validates a client-supplied currency against the allowed list; anything
// missing or unknown falls back to the default. The client never supplies a price.
function resolveCurrency(c) {
  const up = String(c || '').toUpperCase();
  return currencies().includes(up) ? up : defaultCurrency();
}

module.exports = {
  get currencies() { return currencies(); },
  get defaultCurrency() { return defaultCurrency(); },
  resolveCurrency,
  // Price of ONE session in minor units, for a (validated) currency.
  priceMinor(currency) {
    const cur = resolveCurrency(currency);
    const key = Object.keys(CFG.session.prices).find((k) => k.toUpperCase() === cur);
    return shared.toMinor(requireNumber(CFG.session.prices[key], `session.prices.${key}`), cur);
  },
  // Suggested currency for a visitor country code (case-insensitive, may be empty).
  suggestedCurrency(country) {
    const map = CFG.session.countryCurrency || {};
    const key = Object.keys(map).find((k) => k.toUpperCase() === String(country || '').toUpperCase());
    return resolveCurrency(key ? map[key] : null);
  },
  maxPerPurchase: Math.max(1, parseInt(CFG.session.maxSessionsPerPurchase, 10) || 1),
  policy: CFG.policy,
  formatMinor(minor, currency) { return shared.formatMinor(minor, currency); },
};
