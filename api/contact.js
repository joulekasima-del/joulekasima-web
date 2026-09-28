const { getResend } = require('../lib/resend');
const { contactFormEmail } = require('../lib/emails/contact-templates');

// Same sender the Thai Talk notify endpoint already uses (api/thai-talk-notify.js)
// — reused as-is rather than introducing a second configurable "from" for
// what's still just the site's one general inbox.
const FROM = process.env.THAI_TALK_EMAIL_FROM || 'Joule Kasima <hello@joulekasima.com>';
const TO = process.env.CONTACT_TO || 'hello@joulekasima.com';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_NAME = 100;
const MAX_EMAIL = 254;
const MAX_MESSAGE = 5000;

// Homepage "Let's talk" contact form (index.html #contact). Mirrors
// api/thai-talk-notify.js's structure and error handling.
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const body = req.body;
  if (!body || typeof body !== 'object') {
    res.status(400).json({ error: 'Invalid request body.' });
    return;
  }

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  const website = typeof body.website === 'string' ? body.website.trim() : '';

  // Honeypot — a real visitor never fills this in (it's visually hidden,
  // not just display:none, and unreachable by tab). A filled value means a
  // bot: pretend it worked, send nothing, and don't log what it contained.
  if (website) {
    res.status(200).json({ ok: true });
    return;
  }

  if (!name || name.length > MAX_NAME) {
    res.status(400).json({ error: 'Please enter a valid name.' });
    return;
  }
  if (!email || email.length > MAX_EMAIL || !EMAIL_RE.test(email)) {
    res.status(400).json({ error: 'Please enter a valid email.' });
    return;
  }
  if (!message || message.length > MAX_MESSAGE) {
    res.status(400).json({ error: 'Please enter a message.' });
    return;
  }

  try {
    const resend = getResend();
    const { subject, html, text } = contactFormEmail({ name, email, message });
    await resend.emails.send({
      from: FROM,
      to: TO,
      replyTo: email,
      subject,
      html,
      text,
    });
    res.status(200).json({ ok: true });
  } catch (err) {
    // Deliberately not logging name/email/message here — just enough to
    // know the send failed.
    console.error('contact form email failed:', err && err.message ? err.message : err);
    res.status(500).json({ error: 'Could not send your message. Please try again.' });
  }
};
