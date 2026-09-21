const { wrapEmail, escapeHtml } = require('./wrapper');

// Sent once per booking, ~24h after the session (see cron-reminder.js).
// Deliberately low-pressure — this is an invitation, not an ask for a
// rating. Links to a form that defaults to private (see 0002 migration):
// nothing the person writes here becomes public unless they opt in.
function feedbackInviteEmail(b) {
  const url = `${process.env.SITE_URL || 'https://www.joulekasima.com'}/still/feedback?ref=${encodeURIComponent(b.reference)}`;
  const body = `
    <h1 style="font-family:Georgia,serif; font-size:24px; font-weight:600; margin:0 0 8px;">How was your session, ${escapeHtml(b.first_name)}?</h1>
    <p style="font-size:15px; color:#5B6069; margin:0 0 24px;">However it went, I'd love to hear about it — good, bad, or in between. Totally optional, and it's just for me unless you say it's okay to share.</p>
    <a href="${url}" style="display:inline-block; font-family:'Courier New',monospace; font-size:14px; color:#FFFFFF; background:#13161C; border-radius:3px; padding:12px 22px; text-decoration:none;">Share feedback</a>
  `;
  return {
    subject: 'How was your session?',
    html: wrapEmail({ title: 'How was your session?', bodyHtml: body }),
  };
}

module.exports = { feedbackInviteEmail };
