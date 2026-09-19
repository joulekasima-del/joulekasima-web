const { getMonthAvailability, todayISO } = require('../lib/availability');

module.exports = async (req, res) => {
  try {
    const start = todayISO();
    const endYear = 2026;
    const endMonth = 12;
    const [startYear, startMonth] = start.split('-').map(Number);

    const monthsTouched = [];
    let y = startYear;
    let m = startMonth;
    while (y < endYear || (y === endYear && m <= endMonth)) {
      await getMonthAvailability(y, m);
      monthsTouched.push(`${y}-${String(m).padStart(2, '0')}`);
      m += 1;
      if (m > 12) { m = 1; y += 1; }
    }
    res.status(200).json({ success: true, start, monthsTouched });
  } catch (err) {
    res.status(200).json({ success: false, message: err.message });
  }
};
