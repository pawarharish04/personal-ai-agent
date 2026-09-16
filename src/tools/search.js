const https = require('https');

/**
 * Perform a web search using Exa API (https://exa.ai).
 * @param {string} apiKey 
 * @param {string} query 
 * @param {number} numResults 
 */
async function exaSearch(apiKey, query, numResults) {
  const payload = JSON.stringify({
    query: query.trim(),
    type: 'auto',
    numResults: Math.min(numResults || 3, 5),
    contents: {
      highlights: true
    }
  });

  return new Promise((resolve, reject) => {
    const req = https.request(
      'https://api.exa.ai/search',
      {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        }
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => {
          try {
            const body = JSON.parse(raw);
            if (res.statusCode !== 200 || body.error) {
              const msg = body.error || body.message || `HTTP ${res.statusCode}`;
              return resolve({ error: 'API_ERROR', message: msg });
            }
            const results = (body.results || []).slice(0, 3).map(r => {
              let snippet = Array.isArray(r.highlights) && r.highlights.length > 0 
                ? r.highlights.join(' ') 
                : (r.text || '');
              if (snippet.length > 1200) {
                snippet = snippet.substring(0, 1200) + '...';
              }
              return {
                title: (r.title || '').substring(0, 100),
                url: r.url || '',
                snippet
              };
            });
            resolve({ query, results });
          } catch (err) {
            reject(new Error(`Failed to parse Exa search response: ${err.message}`));
          }
        });
        res.on('error', reject);
      }
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

/**
 * Perform a web search using Tavily API.
 */
async function tavilySearch(apiKey, query, numResults) {
  const payload = JSON.stringify({
    api_key: apiKey,
    query: query.trim(),
    search_depth: 'basic',
    max_results: Math.min(numResults || 5, 10)
  });

  return new Promise((resolve, reject) => {
    const req = https.request(
      'https://api.tavily.com/search',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        }
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => {
          try {
            const body = JSON.parse(raw);
            if (res.statusCode !== 200 || body.error) {
              return resolve({ error: 'API_ERROR', message: body.error || `HTTP ${res.statusCode}` });
            }
            const results = (body.results || []).map(r => ({
              title: r.title || '',
              url: r.url || '',
              snippet: r.content || ''
            }));
            resolve({ query, results });
          } catch (err) {
            reject(new Error(`Failed to parse Tavily search response: ${err.message}`));
          }
        });
        res.on('error', reject);
      }
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

/**
 * Perform a web search using Google Custom Search JSON API.
 */
async function googleCustomSearch(apiKey, cx, query, numResults) {
  const num = Math.min(numResults || 5, 10);
  const q = encodeURIComponent(query.trim());
  const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cx}&q=${q}&num=${num}`;

  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let raw = '';
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        try {
          const body = JSON.parse(raw);
          if (res.statusCode === 429 || (body.error && body.error.code === 429)) {
            return resolve({
              error: 'QUOTA_EXCEEDED',
              message: 'Google Custom Search free-tier quota exceeded (100 queries/day).'
            });
          }
          if (res.statusCode !== 200 || body.error) {
            const msg = body.error ? body.error.message : `HTTP ${res.statusCode}`;
            return resolve({ error: 'API_ERROR', message: msg });
          }
          const items = body.items || [];
          const results = items.map(item => ({
            title: item.title || '',
            url: item.link || '',
            snippet: item.snippet || ''
          }));
          resolve({ query, results });
        } catch (err) {
          reject(new Error(`Failed to parse search response: ${err.message}`));
        }
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}

/**
 * Perform a web search using Exa (preferred), Tavily, or Google Custom Search.
 * @param {Object} params - { query: string, numResults?: number }
 * @returns {Object} { query, results: [{ title, url, snippet }] }
 */
async function webSearch(params) {
  if (!params.query || !params.query.trim()) {
    throw new Error('Missing required parameter: query');
  }

  // 1. Try Exa (fast, neural search for AI agents)
  const exaKey = process.env.EXA_API_KEY;
  if (exaKey && exaKey !== 'your_exa_api_key_here') {
    return exaSearch(exaKey, params.query, params.numResults);
  }

  // 2. Try Tavily
  const tavilyKey = process.env.TAVILY_API_KEY;
  if (tavilyKey && tavilyKey !== 'your_tavily_api_key_here') {
    return tavilySearch(tavilyKey, params.query, params.numResults);
  }

  // 3. Try Google Custom Search
  const googleKey = process.env.GOOGLE_SEARCH_API_KEY;
  const googleCx = process.env.GOOGLE_SEARCH_ENGINE_ID;
  if (googleKey && googleKey !== 'your_google_search_api_key_here' &&
      googleCx && googleCx !== 'your_google_search_engine_id_here') {
    return googleCustomSearch(googleKey, googleCx, params.query, params.numResults);
  }

  return {
    error: 'MISSING_CONFIG',
    message: 'Web search is not configured. Add EXA_API_KEY to your .env file (get a key at https://dashboard.exa.ai).'
  };
}

module.exports = { webSearch };
