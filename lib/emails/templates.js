const { wrapEmail, escapeHtml } = require('./wrapper');

function fmtWhen(dateStr, timeStr) {
  const d = new Date(`${dateStr}T${timeStr}`);
  const day = d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Bangkok' });
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Bangkok' });
  return `${day} · ${time} (Chiang Mai time, GMT+7)`;
}

function row(label, value) {
  return `<tr><td style="padding:9px 0; border-top:1px solid #DFDCD4; font-family:'Courier New',monospace; font-size:12px; color:#8B909A;">${label}</td><td style="padding:9px 0; border-top:1px solid #DFDCD4; font-size:14px; color:#13161C; text-align:right;">${value}</td></tr>`;
}

function cancelUrl(reference, cancelToken) {
  return `${process.env.SITE_URL || 'https://www.joulekasima.com'}/cancel?ref=${reference}&token=${cancelToken}`;
}

function sessionCard(s) {
  return `
    <div style="border:1px solid #DFDCD4; border-radius:3px; padding:16px 18px; margin-bottom:12px;">
      <div style="display:flex; justify-content:space-between; font-family:'Courier New',monospace; font-size:11.5px; color:#8B909A; margin-bottom:8px;">
        <span>${escapeHtml(s.reference)}</span>
      </div>
      <div style="font-size:15px; color:#13161C; margin-bottom:10px;">${fmtWhen(s.date, s.start_time)}</div>
      <div style="font-family:'Courier New',monospace; font-size:11px; color:#8A5F24; margin-bottom:3px;">&gt; CALL LINK</div>
      <div style="font-family:'Courier New',monospace; font-size:12.5px; color:#13161C; word-break:break-all;"><a href="${escapeHtml(s.call_link)}" style="color:#13161C;">${escapeHtml(s.call_link)}</a></div>
    </div>`;
}

// purchase = { first_name, last_name, email, total_paid_thb, sessions: [{reference, date, start_time, call_link, calendar_sync_failed}] }
function bookingConfirmationEmail(purchase) {
  const n = purchase.sessions.length;
  const intro = n > 1
    ? `All ${n} of your sessions are booked and on the calendar — nothing left to arrange.`
    : `Your session is booked and on the calendar.`;
  const cards = purchase.sessions.map((s) => sessionCard(s)).join('');
  const cancelLines = purchase.sessions
    .map((s) => `<div style="font-size:12px; color:#8B909A; margin-bottom:4px;">${escapeHtml(s.reference)} — <a href="${cancelUrl(s.reference, s.cancel_token)}" style="color:#8A5F24;">manage this session</a></div>`)
    .join('');

  const body = `
    <h1 style="font-family:Georgia,serif; font-size:26px; font-weight:600; margin:0 0 8px;">You're set, ${escapeHtml(purchase.first_name)}.</h1>
    <p style="font-size:15px; color:#5B6069; margin:0 0 24px;">${intro}</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
      ${row('total paid', `฿${purchase.total_paid_thb}`)}
      ${row('sessions', n)}
    </table>
    ${cards}
    <p style="font-size:14px; color:#5B6069;">Each session has also been added to your Google Calendar if you accept the invite. A reminder goes out 24 hours and 15 minutes before each one.</p>
    <p style="font-size:13px; color:#8B909A; margin-top:24px;">Need to cancel a session?</p>
    ${cancelLines}
    <p style="font-size:12px; color:#8B909A; font-style:italic; margin-top:16px;">Full refund 48+ hours before. 50% refund 24–48 hours before. No refund under 24 hours. If I have to cancel, you're always fully refunded. Cancelling one session never affects the others.</p>
  `;
  return {
    subject: n > 1 ? `You're booked — ${n} sessions` : `You're booked — ${purchase.sessions[0].reference}`,
    html: wrapEmail({ title: 'Booking confirmed', bodyHtml: body }),
  };
}

function providerNotificationEmail(purchase) {
  const rows = purchase.sessions
    .map((s) => row(s.reference, `${fmtWhen(s.date, s.start_time)}${s.calendar_sync_failed ? ' — ⚠ calendar sync failed' : ''}`))
    .join('');
  const body = `
    <h1 style="font-family:Georgia,serif; font-size:22px; font-weight:600; margin:0 0 16px;">New Still booking${purchase.sessions.length > 1 ? ` — ${purchase.sessions.length} sessions` : ''}</h1>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      ${row('name', `${purchase.first_name} ${purchase.last_name}`)}
      ${row('email', purchase.email)}
      ${row('phone', purchase.phone || '—')}
      ${row('notes', purchase.notes || '—')}
      ${row('total paid', `฿${purchase.total_paid_thb}`)}
      ${rows}
    </table>
  `;
  return { subject: `New booking — ${purchase.sessions.length} session${purchase.sessions.length > 1 ? 's' : ''}`, html: wrapEmail({ title: 'New booking', bodyHtml: body }) };
}

function reminderEmail(b, { minutesBefore }) {
  const when = minutesBefore <= 15 ? 'in 15 minutes' : 'tomorrow';
  const body = `
    <h1 style="font-family:Georgia,serif; font-size:24px; font-weight:600; margin:0 0 8px;">Your session is ${when} — ${fmtWhen(b.date, b.start_time)}</h1>
    <p style="font-size:15px; color:#5B6069;">Just a reminder. Nothing to prepare — just show up.</p>
    <div style="border:1px dashed #D9C6A0; background:#EFE3CD; border-radius:3px; padding:16px 18px; margin:20px 0;">
      <div style="font-family:'Courier New',monospace; font-size:11px; color:#8A5F24; margin-bottom:6px;">&gt; YOUR CALL LINK</div>
      <div style="font-family:'Courier New',monospace; font-size:14px; color:#13161C; word-break:break-all;"><a href="${escapeHtml(b.call_link)}" style="color:#13161C;">${escapeHtml(b.call_link)}</a></div>
    </div>
  `;
  return {
    subject: minutesBefore <= 15 ? `Starting soon — your Still session` : `Reminder — your Still session is tomorrow`,
    html: wrapEmail({ title: 'Session reminder', bodyHtml: body }),
  };
}

function cancellationEmail(b, refundThb) {
  const body = `
    <h1 style="font-family:Georgia,serif; font-size:24px; font-weight:600; margin:0 0 8px;">Session cancelled</h1>
    <p style="font-size:15px; color:#5B6069;">Your session (${b.reference}) on ${fmtWhen(b.date, b.start_time)} has been cancelled.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      ${row('refund', refundThb > 0 ? `฿${refundThb}` : 'No refund — under 24 hours notice')}
    </table>
    <p style="font-size:13px; color:#8B909A; margin-top:20px;">${refundThb > 0 ? 'This will land back on your card in a few business days.' : ''} Any other sessions from the same purchase are untouched.</p>
  `;
  return { subject: `Cancelled — ${b.reference}`, html: wrapEmail({ title: 'Session cancelled', bodyHtml: body }) };
}

module.exports = {
  bookingConfirmationEmail,
  providerNotificationEmail,
  reminderEmail,
  cancellationEmail,
};
