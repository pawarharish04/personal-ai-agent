const { google } = require('googleapis');
const path = require('path');
const { GoogleAuthManager } = require('./auth/google-auth');

// Instantiated with default token storage path (or app userData path when passed)
function getAuthManager(tokensFilePath) {
  return new GoogleAuthManager(tokensFilePath);
}

/**
 * Helper to parse specific header values from a Gmail message payload
 */
function getHeader(headers, name) {
  if (!headers) return '';
  const header = headers.find(h => h.name.toLowerCase() === name.toLowerCase());
  return header ? header.value : '';
}

/**
 * List/Search Gmail messages
 * @param {Object} params - { query?: string, maxResults?: number }
 * @param {string} [tokensFilePath] - Path to encrypted token file
 */
async function gmailListMessages(params = {}, tokensFilePath) {
  const authManager = getAuthManager(tokensFilePath);
  const auth = await authManager.getAuthenticatedClient();
  const gmail = google.gmail({ version: 'v1', auth });

  const query = params.query || '';
  const maxResults = Math.min(params.maxResults || 5, 20);

  const listRes = await gmail.users.messages.list({
    userId: 'me',
    q: query,
    maxResults
  });

  const messages = listRes.data.messages || [];
  if (messages.length === 0) {
    return { count: 0, query, messages: [] };
  }

  // Fetch details for each message
  const messageDetails = await Promise.all(
    messages.map(async (msg) => {
      try {
        const detailRes = await gmail.users.messages.get({
          userId: 'me',
          id: msg.id,
          format: 'full'
        });

        const payload = detailRes.data.payload || {};
        const headers = payload.headers || [];

        return {
          id: detailRes.data.id,
          threadId: detailRes.data.threadId,
          snippet: detailRes.data.snippet || '',
          from: getHeader(headers, 'From'),
          to: getHeader(headers, 'To'),
          subject: getHeader(headers, 'Subject'),
          date: getHeader(headers, 'Date')
        };
      } catch (err) {
        return {
          id: msg.id,
          error: `Failed to fetch message details: ${err.message}`
        };
      }
    })
  );

  return {
    count: messageDetails.length,
    query,
    messages: messageDetails
  };
}

/**
 * Send an email via Gmail
 * @param {Object} params - { to: string, subject: string, body: string }
 * @param {string} [tokensFilePath] - Path to encrypted token file
 */
async function gmailSendMessage(params, tokensFilePath) {
  if (!params.to || !params.subject || !params.body) {
    throw new Error('Missing required parameters: to, subject, and body are all required.');
  }

  const authManager = getAuthManager(tokensFilePath);
  const auth = await authManager.getAuthenticatedClient();
  const gmail = google.gmail({ version: 'v1', auth });

  // Build RFC 2822 email format
  const utf8Body = Buffer.from(params.body, 'utf-8').toString('utf-8');
  const mimeMessage = [
    `To: ${params.to}`,
    'Content-Type: text/plain; charset=utf-8',
    'MIME-Version: 1.0',
    `Subject: =?UTF-8?B?${Buffer.from(params.subject).toString('base64')}?=`,
    '',
    utf8Body
  ].join('\r\n');

  const encodedMessage = Buffer.from(mimeMessage)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const sendRes = await gmail.users.messages.send({
    userId: 'me',
    requestBody: {
      raw: encodedMessage
    }
  });

  return {
    status: 'sent',
    messageId: sendRes.data.id,
    threadId: sendRes.data.threadId,
    to: params.to,
    subject: params.subject
  };
}

module.exports = {
  gmailListMessages,
  gmailSendMessage
};
