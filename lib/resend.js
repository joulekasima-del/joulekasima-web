const { Resend } = require('resend');

let client = null;

function getResend() {
  if (client) return client;

  const key = process.env.RESEND_API_KEY;
  if (!key) {
    throw new Error('Missing RESEND_API_KEY env var — Still emails cannot send without it.');
  }

  client = new Resend(key);
  return client;
}

const FROM = process.env.STILL_EMAIL_FROM || 'Still <still@joulekasima.com>';
const PROVIDER_EMAIL = process.env.STILL_PROVIDER_EMAIL || 'hello@joulekasima.com';

module.exports = { getResend, FROM, PROVIDER_EMAIL };
