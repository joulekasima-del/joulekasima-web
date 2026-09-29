const { getSupabase } = require('../supabase');
const { getResend } = require('../resend');
const { thaiTalkNotifyConfirmationEmail } = require('../emails/thai-talk-templates');

// Not a Still-specific address — defaults to the site's general inbox,
// overridable via THAI_TALK_EMAIL_FROM if a dedicated sender is wanted later.
const FROM = process.env.THAI_TALK_EMAIL_FROM || 'Joule Kasima <hello@joulekasima.com>';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// "Notify me" signup for the Thai Talk Breaks launch, from the homepage.
// Reached via api/forms.js with { formType: "thai-talk-notify" } — see that
// file's dispatch. Reuses the shared email_subscribers table (same one
// Still booking writes to) rather than a new table, since it's a single
// global subscriber list — upsert with ignoreDuplicates so someone already
// subscribed from Still booking doesn't hit the unique-email constraint.
// Returns { status, json } rather than writing to a response object
// directly, so this stays easy to unit-test in isolation.
async function handleThaiTalkNotify(body) {
  try {
    const email = String(body.email || '').trim().toLowerCase();
    if (!email || !EMAIL_RE.test(email)) {
      return { status: 400, json: { error: 'A valid email is required' } };
    }

    const supabase = getSupabase();
    const { error } = await supabase
      .from('email_subscribers')
      .upsert({ email, source: 'thai_talk_notify' }, { onConflict: 'email', ignoreDuplicates: true });
    if (error) throw error;

    // The signup itself succeeded once the row is written — don't fail the
    // request over a flaky confirmation email.
    try {
      const resend = getResend();
      const { subject, html } = thaiTalkNotifyConfirmationEmail();
      await resend.emails.send({ from: FROM, to: email, subject, html });
    } catch (emailErr) {
      console.error('thai-talk-notify confirmation email failed', emailErr);
    }

    return { status: 200, json: { ok: true } };
  } catch (err) {
    console.error('thai-talk-notify error', err);
    return { status: 500, json: { error: 'Could not save your email. Please try again.' } };
  }
}

module.exports = { handleThaiTalkNotify };
