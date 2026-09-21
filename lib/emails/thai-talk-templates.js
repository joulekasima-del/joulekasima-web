const { wrapEmail } = require('./wrapper');

// Confirmation email for the Thai Talk Breaks "notify me" signup on the
// homepage. Not Still-specific, so it omits the "still" tag pill and uses
// a plain site footer instead of the Still one (both via the generalized
// wrapEmail() params — see wrapper.js).
function thaiTalkNotifyConfirmationEmail() {
  const body = `
    <h1 style="font-family:Georgia,serif; font-size:24px; font-weight:600; margin:0 0 8px;">You're on the list.</h1>
    <p style="font-size:15px; color:#5B6069; margin:0 0 4px;">You'll get an email the moment <strong>Thai Talk: Jot It Down</strong> launches — nothing before that.</p>
  `;
  return {
    subject: "You're on the list — Thai Talk: Jot It Down",
    html: wrapEmail({
      title: "You're on the list",
      bodyHtml: body,
      tag: null,
      footerHtml: 'Joule Kasima · <a href="https://www.joulekasima.com" style="color:#8B909A;">joulekasima.com</a>',
    }),
  };
}

module.exports = { thaiTalkNotifyConfirmationEmail };
