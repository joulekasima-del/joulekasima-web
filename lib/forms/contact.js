const { getResend } = require('../resend');
const { contactFormEmail } = require('../emails/contact-templates');

// Same sender the Thai Talk notify flow already uses — reused as-is rather
// than introducing a second configurable "from" for what's still just the
// site's one general inbox.
const FROM = process.env.THAI_TALK_EMAIL_FROM || 'Joule Kasima <hello@joulekasima.com>';
const TO = process.env.CONTACT_TO || 'hello@joulekasima.com';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_NAME = 100;
const MAX_EMAIL = 254;
const MAX_MESSAGE = 5000;

// Homepage "Let's talk" contact form (index.html #contact). Reached via
// api/forms.js with { formType: "contact" } — see that file's dispatch.
// Returns { status, json } rather than writing to a response object
// directly, so this stays easy to unit-test in isolation.
async function handleContact(body) {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  const website = typeof body.website === 'string' ? body.website.trim() : '';

  // Honeypot — a real visitor never fills this in (it's visually hidden,
  // not just display:none, and unreachable by tab). A filled value means a
  // bot: pretend it worked, send nothing, and don't log what it contained.
  if (website) {
    return { status: 200, json: { ok: true } };
  }

  if (!name || name.length > MAX_NAME) {
    return { status: 400, json: { error: 'Please enter a valid name.' } };
  }
  if (!email || email.length > MAX_EMAIL || !EMAIL_RE.test(email)) {
    return { status: 400, json: { error: 'Please enter a valid email.' } };
  }
  if (!message || message.length > MAX_MESSAGE) {
    return { status: 400, json: { error: 'Please enter a message.' } };
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
    return { status: 200, json: { ok: true } };
  } catch (err) {
    // Deliberately not logging name/email/message here — just enough to
    // know the send failed.
    console.error('contact form email failed:', err && err.message ? err.message : err);
    return { status: 500, json: { error: 'Could not send your message. Please try again.' } };
  }
}

module.exports = { handleContact };
