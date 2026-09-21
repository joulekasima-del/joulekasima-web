const { randomUUID } = require('crypto');
const { getSupabase } = require('../../lib/supabase');

const MAX_NAME_LEN = 200;
const MAX_MESSAGE_LEN = 4000;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_PHOTO_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

// Post-session feedback form submission (see /still/feedback). Private by
// default — consent_public is only true if the person explicitly checked
// the "okay to share this publicly" box. A photo is optional; when present
// it's sent as base64 JSON (matching this codebase's other JSON-only routes
// rather than adding a multipart-parsing dependency) and uploaded to the
// feedback-photos storage bucket.
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    const body = req.body || {};
    const reference = body.reference ? String(body.reference).trim().slice(0, 40) : null;
    const name = String(body.name || '').trim().slice(0, MAX_NAME_LEN);
    const message = String(body.message || '').trim().slice(0, MAX_MESSAGE_LEN);
    const consent_public = body.consent_public === true;
    const photo_base64 = body.photo_base64 || null;
    const photo_type = body.photo_type || null;

    if (!name) {
      res.status(400).json({ error: 'Your name is required.' });
      return;
    }
    if (!message) {
      res.status(400).json({ error: 'Please write a little about how it went.' });
      return;
    }

    const supabase = getSupabase();
    let photo_url = null;

    if (photo_base64) {
      const ext = ALLOWED_PHOTO_TYPES[photo_type];
      if (!ext) {
        res.status(400).json({ error: 'Photo must be a JPEG, PNG, or WebP image.' });
        return;
      }
      const buffer = Buffer.from(photo_base64, 'base64');
      if (buffer.length === 0 || buffer.length > MAX_PHOTO_BYTES) {
        res.status(400).json({ error: 'Photo must be under 5MB.' });
        return;
      }
      const path = `${randomUUID()}.${ext}`;
      const { error: uploadErr } = await supabase.storage
        .from('feedback-photos')
        .upload(path, buffer, { contentType: photo_type, upsert: false });
      if (uploadErr) throw uploadErr;

      const { data: publicUrlData } = supabase.storage.from('feedback-photos').getPublicUrl(path);
      photo_url = publicUrlData?.publicUrl || null;
    }

    const { error: insertErr } = await supabase.from('session_feedback').insert({
      booking_reference: reference,
      name,
      message,
      photo_url,
      consent_public,
    });
    if (insertErr) throw insertErr;

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('still/feedback error', err);
    res.status(500).json({ error: 'Could not save your feedback. Please try again.' });
  }
};
