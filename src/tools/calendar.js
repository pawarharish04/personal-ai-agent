const { google } = require('googleapis');
const { GoogleAuthManager } = require('./auth/google-auth');

function getAuthManager(tokensFilePath) {
  return new GoogleAuthManager(tokensFilePath);
}

/**
 * List upcoming Google Calendar events
 * @param {Object} params - { maxResults?: number, calendarId?: string, timeMin?: string }
 * @param {string} [tokensFilePath]
 */
async function calendarListEvents(params = {}, tokensFilePath) {
  const authManager = getAuthManager(tokensFilePath);
  const auth = await authManager.getAuthenticatedClient();
  const calendar = google.calendar({ version: 'v3', auth });

  const calendarId = params.calendarId || 'primary';
  const maxResults = Math.min(params.maxResults || 10, 25);
  const timeMin = params.timeMin || new Date().toISOString();

  const res = await calendar.events.list({
    calendarId,
    timeMin,
    maxResults,
    singleEvents: true,
    orderBy: 'startTime'
  });

  const events = res.data.items || [];
  if (events.length === 0) {
    return { count: 0, calendarId, events: [] };
  }

  return {
    count: events.length,
    calendarId,
    events: events.map(event => ({
      id: event.id,
      summary: event.summary || '(No title)',
      description: event.description || '',
      location: event.location || '',
      start: event.start?.dateTime || event.start?.date || '',
      end: event.end?.dateTime || event.end?.date || '',
      htmlLink: event.htmlLink || ''
    }))
  };
}

/**
 * Create a new Google Calendar event. REQUIRES USER APPROVAL.
 * @param {Object} params - { summary, description?, location?, startDateTime, endDateTime, calendarId? }
 * @param {string} [tokensFilePath]
 */
async function calendarCreateEvent(params, tokensFilePath) {
  if (!params.summary || !params.startDateTime || !params.endDateTime) {
    throw new Error('Missing required parameters: summary, startDateTime, and endDateTime are all required.');
  }

  const authManager = getAuthManager(tokensFilePath);
  const auth = await authManager.getAuthenticatedClient();
  const calendar = google.calendar({ version: 'v3', auth });

  const calendarId = params.calendarId || 'primary';

  const eventBody = {
    summary: params.summary,
    description: params.description || '',
    location: params.location || '',
    start: {
      dateTime: params.startDateTime,
      timeZone: params.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone
    },
    end: {
      dateTime: params.endDateTime,
      timeZone: params.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone
    }
  };

  const res = await calendar.events.insert({
    calendarId,
    requestBody: eventBody
  });

  return {
    status: 'created',
    id: res.data.id,
    summary: res.data.summary,
    start: res.data.start?.dateTime || res.data.start?.date || '',
    end: res.data.end?.dateTime || res.data.end?.date || '',
    htmlLink: res.data.htmlLink || ''
  };
}

module.exports = {
  calendarListEvents,
  calendarCreateEvent
};
