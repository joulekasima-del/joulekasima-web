(function (root) {
  const ZERO_DECIMAL = ['BIF','CLP','DJF','GNF','JPY','KMF','KRW','MGA','PYG','RWF','UGX','VND','VUV','XAF','XOF','XPF'];

  const WHOLE_WHEN_ROUND = ['THB'];

  function minorFactor(currency) {
    return ZERO_DECIMAL.includes(String(currency).toUpperCase()) ? 1 : 100;
  }
  function toMinor(amount, currency) {
    return Math.round(Number(amount) * minorFactor(currency));
  }
  function fromMinor(minor, currency) {
    return Number(minor) / minorFactor(currency);
  }
  function formatMoney(amount, currency) {
    if (amount === null || amount === undefined || amount === '' || !isFinite(Number(amount))) return String(amount);
    try {
      const cur = String(currency).toUpperCase();
      const opts = { style: 'currency', currency: cur, currencyDisplay: 'narrowSymbol' };
      // Baht is shown as whole baht (฿750) whenever the amount is a round number;
      // an amount with satang (e.g. ฿375.50) still shows them. Other currencies
      // (USD -> $25.00) keep their default digits.
      if (WHOLE_WHEN_ROUND.includes(cur) && Number.isInteger(Number(amount))) {
        opts.minimumFractionDigits = 0;
        opts.maximumFractionDigits = 0;
      }
      return new Intl.NumberFormat('en-US', opts).format(Number(amount));
    } catch (e) {
      return `${amount} ${currency}`;
    }
  }
  function formatMinor(minor, currency) {
    return formatMoney(fromMinor(minor, currency), currency);
  }

  function sortedTiers(policy) {
    return [...((policy && policy.refundTiers) || [])].sort((a, b) => b.hoursBefore - a.hoursBefore);
  }
  function refundPercent(hoursUntilStart, policy) {
    for (const t of sortedTiers(policy)) if (hoursUntilStart >= t.hoursBefore) return t.percent;
    return 0;
  }
  function policyText(policy) {
    const tiers = sortedTiers(policy);
    if (!tiers.length) return 'Sessions are non-refundable.';
    const parts = tiers.map((t, i) => {
      const what = t.percent >= 100 ? 'Full refund' : `${t.percent}% refund`;
      return i === 0 ? `${what} ${t.hoursBefore}+ hours before.` : `${what} ${t.hoursBefore}–${tiers[i - 1].hoursBefore} hours before.`;
    });
    const last = tiers[tiers.length - 1];
    if (last.hoursBefore > 0) parts.push(`No refund under ${last.hoursBefore} hours.`);
    if (policy.providerCancelNote) parts.push(policy.providerCancelNote);
    return parts.join(' ');
  }

  const api = { minorFactor, toMinor, fromMinor, formatMoney, formatMinor, refundPercent, policyText };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Shared = api;
})(typeof window !== 'undefined' ? window : this);
