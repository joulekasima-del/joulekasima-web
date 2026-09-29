(function (root) {
  const config = {
    session: {
      price: 25,           // whole currency units — see note below before ever changing this
      currency: 'USD',
      maxSessionsPerPurchase: 10,
    },
    policy: {
      refundTiers: [ { hoursBefore: 48, percent: 100 }, { hoursBefore: 24, percent: 50 } ],
      providerCancelNote: "If I have to cancel, you're always fully refunded.",
    },
  };
  // NOTE: if you ever add or switch to a different currency, pick the price
  // by hand and round UP to a clean number (e.g. 25 -> 24 or 25 in EUR, not
  // a literal FX-converted decimal like 23.14). Do not compute this from a
  // live exchange rate — rates drift, this config should not.
  if (typeof module === 'object' && module.exports) module.exports = config;
  else root.StillConfig = config;
})(typeof window !== 'undefined' ? window : this);
