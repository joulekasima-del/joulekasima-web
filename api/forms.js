const { handleContact } = require('../lib/forms/contact');
const { handleThaiTalkNotify } = require('../lib/forms/thai-talk-notify');

// Single shared endpoint for the site's two small homepage forms (the
// "Let's talk" contact form and the Thai Talk Breaks notify signup),
// consolidated into one serverless function to stay under Vercel Hobby's
// 12-function-per-deployment cap. Each form's actual validation, honeypot
// handling, and email template lives entirely in its own lib/forms/ file —
// this file only reads formType and dispatches; it never touches either
// form's own logic.
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const body = req.body;
  if (!body || typeof body !== 'object') {
    res.status(400).json({ error: 'Invalid request body.' });
    return;
  }

  const { formType } = body;
  let result;
  if (formType === 'contact') {
    result = await handleContact(body);
  } else if (formType === 'thai-talk-notify') {
    result = await handleThaiTalkNotify(body);
  } else {
    res.status(400).json({ error: 'Unknown form type.' });
    return;
  }

  res.status(result.status).json(result.json);
};
