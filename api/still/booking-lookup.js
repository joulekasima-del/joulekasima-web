const { getSupabase } = require('../../lib/supabase');

function hoursUntil(date, startTime) {
  const sessionStart = new Date(`${date}T${startTime}+07:00`);
  return (sessionStart.getTime() - Date.now()) / (1000 * 60 * 60);
}

// Used by /cancel to show the booking + a preview of what cancelling now
// would do, before the participant confirms. Requires the private
// cancel_token from the confirmation email/page — this is intentionally
// not searchable by reference alone.
module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    const { ref, token } = req.query;
    if (!ref || !token) {
      res.status(400).json({ error: 'ref and token are required' });
      return;
    }
    const supabase = getSupabase();
    const { data: booking, error } = await supabase
      .from('bookings')
      .select('reference, first_name, status, amount_paid_thb, cancel_token, availability:availability_id(date, start_time)')
      .eq('reference', ref)
      .single();
    if (error || !booking || booking.cancel_token !== token) {
      res.status(404).json({ error: 'Booking not found.' });
      return;
    }

    const hours = hoursUntil(booking.availability.date, booking.availability.start_time);

    let preview;
    if (booking.status !== 'confirmed') {
      preview = { text: `This booking is already ${booking.status}.`, actionable: false };
    } else {
      const paid = booking.amount_paid_thb || 0;
      if (hours >= 48) preview = { text: `Cancelling now refunds ฿${paid} in full (48+ hours notice).`, actionable: true };
      else if (hours >= 24) preview = { text: `Cancelling now refunds ฿${Math.round(paid / 2)} (50%, 24–48 hours notice).`, actionable: true };
      else preview = { text: "Cancelling now gives no refund — it's under 24 hours before the session.", actionable: true };
    }

    res.status(200).json({
      reference: booking.reference,
      first_name: booking.first_name,
      status: booking.status,
      date: booking.availability.date,
      start_time: booking.availability.start_time,
      preview,
    });
  } catch (err) {
    console.error('still/booking-lookup error', err);
    res.status(500).json({ error: 'Could not look up that booking.' });
  }
};
