const crypto = require('crypto');

// ST-XXXXXXXX — 8-char alphanumeric, mirrors Kraft Junction's KJ-XXXXXXXX (decided §6).
function generateBookingReference() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I ambiguity
  let ref = 'ST-';
  const bytes = crypto.randomBytes(8);
  for (let i = 0; i < 8; i++) {
    ref += chars[bytes[i] % chars.length];
  }
  return ref;
}

module.exports = { generateBookingReference };
