const { getSupabase } = require('../lib/supabase');
const { getResend } = require('../lib/resend');
const { thaiTalkNotifyConfirmationEmail } = require('../lib/emails/thai-talk-templates');

// Not a Still-specific address — defaults to the site's general inbox,
// overridable via THAI_TALK_EMAIL_FROM if a dedicated sender is wanted later.
const FROM = process.env.THAI_TALK_EMAIL_FROM || 'Joule Kasima <hello@joulekasima.com>';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// "Notify me" signup for the Thai Talk Breaks launch, from the homepage.
// Reuses the shared email_subscribers table (same one Still booking writes
// to) rather than a new table, since it's a single global subscriber list —
// upsert with ignoreDuplicates so someone already subscribed from Still
// booking doesn't hit the unique-email constraint.
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    const email = String((req.body || {}).email || '').trim().toLowerCase();
    if (!email || !EMAIL_RE.test(email)) {
      res.status(400).json({ error: 'A valid email is required' });
      return;
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

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('thai-talk-notify error', err);
    res.status(500).json({ error: 'Could not save your email. Please try again.' });
  }
};
