const { holdSlot, HOLD_MINUTES } = require('../../lib/availability');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    const { availability_id, hold_token } = req.body || {};
    if (!availability_id || !hold_token) {
      res.status(400).json({ error: 'availability_id and hold_token are required' });
      return;
    }
    const row = await holdSlot({ availabilityId: availability_id, holdToken: hold_token });
    res.status(200).json({
      ok: true,
      locked_until: row.locked_until,
      hold_minutes: HOLD_MINUTES,
    });
  } catch (err) {
    if (err.message === 'SLOT_UNAVAILABLE') {
      res.status(409).json({ error: 'That slot was just taken. Please pick another.' });
      return;
    }
    if (err.message === 'TOO_SOON') {
      res.status(409).json({ error: 'Sessions need to be booked at least 1 day in advance.' });
      return;
    }
    console.error('still/hold error', err);
    res.status(500).json({ error: 'Could not hold that slot.' });
  }
};
