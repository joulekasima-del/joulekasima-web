const { getSupabase } = require('../../lib/supabase');
const { getResend, FROM } = require('../../lib/resend');
const { reminderEmail } = require('../../lib/emails/templates');

// Called every 5 minutes by the GitHub Actions workflow in
// .github/workflows/still-reminder-cron.yml (not Vercel Cron — Hobby plan
// only allows a once-a-day schedule, and this needs 5-minute granularity to
// catch the 15-minute-before window). Sends two reminders per session: one
// ~24 hours before, one ~15 minutes before (decided §6).
//
// CRON_SECRET must be set — this route refuses every request otherwise,
// since a missing secret should never silently mean "open to anyone."
module.exports = async (req, res) => {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error('CRON_SECRET is not configured — refusing all requests.');
    res.status(500).json({ error: 'Reminder cron is not configured.' });
    return;
  }
  const auth = req.headers.authorization;
  if (auth !== `Bearer ${cronSecret}`) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const supabase = getSupabase();
    const { data: bookings, error } = await supabase
      .from('bookings')
      .select('*, availability:availability_id(date, start_time)')
      .eq('status', 'confirmed')
      .or('reminder_24h_sent.eq.false,reminder_15m_sent.eq.false');
    if (error) throw error;

    const resend = getResend();
    let sent24h = 0;
    let sent15m = 0;

    for (const booking of bookings || []) {
      const sessionStart = new Date(`${booking.availability.date}T${booking.availability.start_time}+07:00`);
      const hoursAway = (sessionStart.getTime() - Date.now()) / (1000 * 60 * 60);
      const minutesAway = (sessionStart.getTime() - Date.now()) / (1000 * 60);
      const emailBooking = { ...booking, date: booking.availability.date, start_time: booking.availability.start_time };

      if (!booking.reminder_24h_sent && hoursAway <= 24.5 && hoursAway >= 23.5) {
        const template = reminderEmail(emailBooking, { minutesBefore: 24 * 60 });
        try {
          await resend.emails.send({ from: FROM, to: booking.email, subject: template.subject, html: template.html });
          await supabase.from('bookings').update({ reminder_24h_sent: true }).eq('id', booking.id);
          sent24h++;
        } catch (e) {
          console.error('Failed to send 24h reminder for', booking.reference, e);
        }
      } else if (!booking.reminder_15m_sent && minutesAway <= 17.5 && minutesAway >= 12.5) {
        const template = reminderEmail(emailBooking, { minutesBefore: 15 });
        try {
          await resend.emails.send({ from: FROM, to: booking.email, subject: template.subject, html: template.html });
          await supabase.from('bookings').update({ reminder_15m_sent: true }).eq('id', booking.id);
          sent15m++;
        } catch (e) {
          console.error('Failed to send 15m reminder for', booking.reference, e);
        }
      }
    }

    res.status(200).json({ ok: true, sent24h, sent15m });
  } catch (err) {
    console.error('still/cron-reminder error', err);
    res.status(500).json({ error: 'Reminder cron failed.' });
  }
};
