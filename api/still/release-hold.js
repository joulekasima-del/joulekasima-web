const { releaseSlot } = require('../../lib/availability');

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
    await releaseSlot({ availabilityId: availability_id, holdToken: hold_token });
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('still/release-hold error', err);
    res.status(500).json({ error: 'Could not release that hold.' });
  }
};
