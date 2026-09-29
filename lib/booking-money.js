// A booking's own stored amount + currency. Falls back to the legacy
// whole-baht column for any row that predates the minor-unit columns, so old
// THB bookings keep refunding/displaying correctly in THB regardless of what
// the config's currency is now.
function bookingAmountMinor(b) {
  if (b.amount_paid_minor !== null && b.amount_paid_minor !== undefined) return b.amount_paid_minor;
  if (b.amount_paid_thb !== null && b.amount_paid_thb !== undefined) return b.amount_paid_thb * 100;
  return 0;
}

function bookingCurrency(b) {
  return String(b.currency || 'THB').toUpperCase();
}

module.exports = { bookingAmountMinor, bookingCurrency };
