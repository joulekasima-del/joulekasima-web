const { getMonthAvailability } = require('../../lib/availability');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    const year = parseInt(req.query.year, 10);
    const month = parseInt(req.query.month, 10); // 1-12
    if (!year || !month || month < 1 || month > 12) {
      res.status(400).json({ error: 'year and month query params required' });
      return;
    }
    const result = await getMonthAvailability(year, month);
    res.status(200).json(result);
  } catch (err) {
    console.error('still/availability error', err);
    res.status(500).json({ error: 'Could not load availability.' });
  }
};
