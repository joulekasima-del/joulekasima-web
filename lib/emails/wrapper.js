// Simple branded HTML wrapper for Still's transactional emails.
// joulekasima-web has no existing email system to reuse (the homepage
// contact form is a visual demo only), so this is a new, minimal wrapper
// kept consistent with the Still landing page's visual identity
// (Fraunces headline, JetBrains Mono labels, amber/ink/cream palette).
// Inline styles throughout — email clients don't reliably apply <style>.

function wrapEmail({ title, bodyHtml }) {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>${escapeHtml(title)}</title></head>
<body style="margin:0; padding:0; background:#F7F6F2; font-family:-apple-system,'Inter',sans-serif; color:#13161C;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F7F6F2; padding:32px 0;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#FFFFFF; border:1px solid #DFDCD4; border-radius:4px; max-width:560px; width:100%;">
        <tr>
          <td style="padding:28px 36px; border-bottom:1px solid #DFDCD4;">
            <span style="font-family:Georgia,serif; font-weight:600; font-size:18px; color:#13161C;">Joule Kasima</span>
            <span style="font-family:'Courier New',monospace; font-size:11px; color:#8A5F24; background:#EFE3CD; border:1px solid #D9C6A0; border-radius:2px; padding:2px 7px; margin-left:8px;">still</span>
          </td>
        </tr>
        <tr>
          <td style="padding:36px;">
            ${bodyHtml}
          </td>
        </tr>
        <tr>
          <td style="padding:20px 36px; border-top:1px solid #DFDCD4; font-family:'Courier New',monospace; font-size:12px; color:#8B909A;">
            Still — 1:1 guided meditation · <a href="https://www.joulekasima.com/still" style="color:#8B909A;">joulekasima.com/still</a>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

module.exports = { wrapEmail, escapeHtml };
