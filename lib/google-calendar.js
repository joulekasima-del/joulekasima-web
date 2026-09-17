const { google } = require('googleapis');

function getOAuthClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      'Missing GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN env vars — Google Calendar sync cannot run without them.'
    );
  }

  const oAuth2Client = new google.auth.OAuth2(clientId, clientSecret);
  oAuth2Client.setCredentials({ refresh_token: refreshToken });
  return oAuth2Client;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Creates a Calendar event with a Google Meet link for a confirmed booking.
 * Retries a couple of times on failure (per the decided fallback), then
 * throws so the caller can fall back to the backup static link and mark
 * calendar_sync_failed = true. Never throws in a way that should roll back
 * the booking — the caller is responsible for keeping it confirmed either way.
 *
 * @returns {Promise<{eventId: string, callLink: string}>}
 */
async function createBookingEvent({ summary, description, startISO, endISO, attendeeEmail }) {
  const auth = getOAuthClient();
  const calendar = google.calendar({ version: 'v3', auth });
  const calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary';

  const requestBody = {
    summary,
    description,
    start: { dateTime: startISO, timeZone: 'Asia/Bangkok' },
    end: { dateTime: endISO, timeZone: 'Asia/Bangkok' },
    attendees: [{ email: attendeeEmail }],
    conferenceData: {
      createRequest: {
        requestId: `still-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        conferenceSolutionKey: { type: 'hangoutsMeet' },
      },
    },
  };

  const attempts = 3;
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await calendar.events.insert({
        calendarId,
        requestBody,
        conferenceDataVersion: 1,
        sendUpdates: 'all',
      });

      const event = res.data;
      const callLink =
        event.hangoutLink ||
        event.conferenceData?.entryPoints?.find((e) => e.entryPointType === 'video')?.uri;

      if (!callLink) {
        throw new Error('Calendar event created but no Meet link came back on it.');
      }

      return { eventId: event.id, callLink };
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) {
        await sleep(500 * Math.pow(2, i)); // short backoff: 500ms, 1000ms
      }
    }
  }
  throw lastErr;
}

async function deleteBookingEvent(eventId) {
  if (!eventId) return;
  const auth = getOAuthClient();
  const calendar = google.calendar({ version: 'v3', auth });
  const calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary';
  try {
    await calendar.events.delete({ calendarId, eventId, sendUpdates: 'all' });
  } catch (err) {
    // Cancellation should still succeed even if the calendar cleanup fails —
    // this mirrors the "never roll back a booking over a calendar failure" rule.
    console.error('Failed to delete calendar event on cancellation:', eventId, err.message);
  }
}

const BACKUP_CALL_LINK = process.env.STILL_BACKUP_CALL_LINK || null;

module.exports = { createBookingEvent, deleteBookingEvent, BACKUP_CALL_LINK };
