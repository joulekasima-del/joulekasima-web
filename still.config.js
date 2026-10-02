(function (root) {
  const config = {
    session: {
      // Whole currency units, per session. Each currency is priced by hand —
      // never derive one from the other with an exchange rate (rates drift,
      // this config should not). Prefer clean numbers.
      prices: { THB: 750, USD: 25 },
      defaultCurrency: 'USD',      // used when the client sends no / an unknown currency
      // Visitor country (ISO code, from Vercel's x-vercel-ip-country header) ->
      // the currency suggested first. Any country not listed gets defaultCurrency.
      countryCurrency: { TH: 'THB' },
      maxSessionsPerPurchase: 10,
    },
    booking: {
      // The last day customers can book, as a Chiang Mai calendar date (UTC+7). Every slot on this
      // day is bookable (21:00 Chiang Mai included); the next day is not. The ONE place this lives:
      // the availability API, hold, payment, the admin block-out tool and the booking calendar all follow it.
      lastBookableDate: '2027-12-31',
    },
    policy: {
      refundTiers: [ { hoursBefore: 48, percent: 100 }, { hoursBefore: 24, percent: 50 } ],
      providerCancelNote: "If I have to cancel, you're always fully refunded.",
    },
  };
  // NOTE: every currency in `prices` must be a currency the Stripe account can
  // charge in. Amounts are converted to minor units by assets/shared.js
  // (THB and USD are both 2-decimal).
  if (typeof module === 'object' && module.exports) module.exports = config;
  else root.StillConfig = config;
})(typeof window !== 'undefined' ? window : this);
