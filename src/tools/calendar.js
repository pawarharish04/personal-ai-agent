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

  let isAllDayStart = /^\\d{4}-\\d{2}-\\d{2}$/.test(params.startDateTime);
  let isAllDayEnd = /^\\d{4}-\\d{2}-\\d{2}$/.test(params.endDateTime);

  // Google Calendar API strictly forbids mixing `date` and `dateTime`.
  // If one is an all-day event format and the other isn't, normalize them to both be all-day.
  if (isAllDayStart && !isAllDayEnd) {
    params.endDateTime = params.endDateTime.split('T')[0];
    isAllDayEnd = true;
  } else if (!isAllDayStart && isAllDayEnd) {
    params.startDateTime = params.startDateTime.split('T')[0];
    isAllDayStart = true;
  }

  let resolvedEndDate = params.endDateTime;
  
  if (isAllDayStart && isAllDayEnd && params.startDateTime === params.endDateTime) {
    // Google Calendar API requires all-day event end dates to be exclusive.
    // If start and end are the same day, increment end by 1 day.
    const dateObj = new Date(params.endDateTime);
    dateObj.setDate(dateObj.getDate() + 1);
    resolvedEndDate = dateObj.toISOString().split('T')[0];
  }

  const start = isAllDayStart 
    ? { date: params.startDateTime }
    : { dateTime: params.startDateTime, timeZone: params.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone };

  const end = isAllDayEnd 
    ? { date: resolvedEndDate }
    : { dateTime: params.endDateTime, timeZone: params.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone };

  const eventBody = {
    summary: params.summary,
    description: params.description || '',
    location: params.location || '',
    start,
    end
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
