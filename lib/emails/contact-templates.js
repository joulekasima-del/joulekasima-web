const { wrapEmail, escapeHtml } = require('./wrapper');

function fmtTimestamp(d) {
  return d.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok' }) + ' (Chiang Mai time, GMT+7)';
}

// Notification email for a homepage "Let's talk" contact-form submission.
// Not Still-specific, so (like thai-talk-templates.js) it omits the "still"
// tag pill and uses a plain site footer via wrapEmail()'s generalized params.
//
// name/email/message are visitor-supplied. They're HTML-escaped before
// going into the HTML body. The subject line's CR/LF stripping happens
// here too, since this is where the subject string is built — see
// lib/forms/contact.js for why that specifically matters (header injection).
function contactFormEmail({ name, email, message }) {
  const timestamp = fmtTimestamp(new Date());
  const safeSubjectName = name.replace(/[\r\n]+/g, ' ').trim();

  const body = `
    <h1 style="font-family:Georgia,serif; font-size:24px; font-weight:600; margin:0 0 8px;">New site message</h1>
    <p style="font-size:15px; color:#5B6069; margin:0 0 20px;">From the "Wanna drop a word?" form on the homepage.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
      <tr><td style="padding:9px 0; border-top:1px solid #DFDCD4; font-family:'Courier New',monospace; font-size:12px; color:#8B909A;">name</td><td style="padding:9px 0; border-top:1px solid #DFDCD4; font-size:14px; color:#13161C; text-align:right;">${escapeHtml(name)}</td></tr>
      <tr><td style="padding:9px 0; border-top:1px solid #DFDCD4; font-family:'Courier New',monospace; font-size:12px; color:#8B909A;">email</td><td style="padding:9px 0; border-top:1px solid #DFDCD4; font-size:14px; color:#13161C; text-align:right;">${escapeHtml(email)}</td></tr>
      <tr><td style="padding:9px 0; border-top:1px solid #DFDCD4; font-family:'Courier New',monospace; font-size:12px; color:#8B909A;">sent</td><td style="padding:9px 0; border-top:1px solid #DFDCD4; font-size:14px; color:#13161C; text-align:right;">${escapeHtml(timestamp)}</td></tr>
    </table>
    <p style="font-size:15px; color:#13161C; white-space:pre-wrap;">${escapeHtml(message)}</p>
  `;

  const text = [
    'New site message',
    'From the "Wanna drop a word?" form on the homepage.',
    '',
    `name: ${name}`,
    `email: ${email}`,
    `sent: ${timestamp}`,
    '',
    message,
  ].join('\n');

  return {
    subject: `Site message from ${safeSubjectName}`,
    html: wrapEmail({
      title: 'New site message',
      bodyHtml: body,
      tag: null,
      footerHtml: 'Joule Kasima · <a href="https://www.joulekasima.com" style="color:#8B909A;">joulekasima.com</a>',
    }),
    text,
  };
}

module.exports = { contactFormEmail };
