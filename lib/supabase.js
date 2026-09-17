const { createClient } = require('@supabase/supabase-js');

let client = null;

// Server-side client using the service role key — every /api route runs
// server-side only, so RLS is bypassed deliberately here. Never import this
// file from anything that ships to the browser.
function getSupabase() {
  if (client) return client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      'Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY env vars — Still booking backend cannot run without them.'
    );
  }

  client = createClient(url, key, {
    auth: { persistSession: false },
  });
  return client;
}

module.exports = { getSupabase };
