const CFG = require('../still.config.js');
const shared = require('../assets/shared.js');

function requireNumber(v, path) {
  const n = Number(v);
  if (!isFinite(n) || n <= 0) throw new Error(`still.config.js: set ${path} to a positive number (got ${JSON.stringify(v)}).`);
  return n;
}
module.exports = {
  get currency()   { return String(CFG.session.currency || 'USD').toUpperCase(); },
  get priceMinor() { return shared.toMinor(requireNumber(CFG.session.price, 'session.price'), this.currency); },
  maxPerPurchase:  Math.max(1, parseInt(CFG.session.maxSessionsPerPurchase, 10) || 1),
  policy:          CFG.policy,
  formatMinor(minor) { return shared.formatMinor(minor, this.currency); },
};
