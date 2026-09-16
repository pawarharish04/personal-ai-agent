const { browserToolInstance } = require('./browser');

// Central Tool Registry and Dispatcher
const toolsRegistry = {
  dummy_safe_action: {
    schema: {
      name: 'dummy_safe_action',
      description: 'A safe read-only tool that returns system status without requiring approval.',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The query term' }
        },
        required: ['query']
      }
    },
    risky: false,
    execute: async (params) => {
      return { status: 'ok', info: `Read-only system check performed for query: "${params.query}"` };
    }
  },

  dummy_risky_action: {
    schema: {
      name: 'dummy_risky_action',
      description: 'A risky tool with side-effects (e.g. sending data or modifying state) that MUST require explicit user approval.',
      input_schema: {
        type: 'object',
        properties: {
          actionName: { type: 'string', description: 'Name of the action to execute' },
          target: { type: 'string', description: 'Target recipient or resource' }
        },
        required: ['actionName', 'target']
      }
    },
    risky: true,
    execute: async (params) => {
      return { status: 'executed', message: `Executed risky action "${params.actionName}" on target "${params.target}".` };
    }
  },

  // --- Web Search ---
  web_search: {
    schema: {
      name: 'web_search',
      description: 'Search the web. Use this as the FIRST step for any question involving current events, real-time data, specific facts, scores, weather, coding problems, news, or anything you do not already know with certainty. Returns top results with title, url, and snippet. Synthesize and answer the user directly from these results.',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The search query. Be specific — include relevant context like dates, site names, or keywords.' },
          numResults: { type: 'number', description: 'Number of results to return (default: 5, max: 10)' }
        },
        required: ['query']
      }
    },
    risky: false,
    execute: async (params) => {
      const { webSearch } = require('./search');
      return await webSearch(params);
    }
  },

  // --- Browser Tools (Playwright) ---
  browser_navigate: {
    schema: {
      name: 'browser_navigate',
      description: 'Navigate to a web URL.',
      input_schema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The HTTP/HTTPS URL to navigate to' }
        },
        required: ['url']
      }
    },
    risky: false,
    execute: async (params) => {
      return await browserToolInstance.navigate(params.url);
    }
  },

  browser_read_page: {
    schema: {
      name: 'browser_read_page',
      description: 'Read the text content of the currently loaded webpage.',
      input_schema: {
        type: 'object',
        properties: {}
      }
    },
    risky: false,
    execute: async () => {
      return await browserToolInstance.readPage();
    }
  },

  browser_find: {
    schema: {
      name: 'browser_find',
      description: 'Search for text, keywords, or a pattern on the currently loaded webpage.',
      input_schema: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'The text or keyword pattern to find on the page' }
        },
        required: ['pattern']
      }
    },
    risky: false,
    execute: async (params) => {
      return await browserToolInstance.find(params.pattern);
    }
  },

  browser_click: {
    schema: {
      name: 'browser_click',
      description: 'Click an interactive button, link, or element on the current webpage.',
      input_schema: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS selector or text selector of the element to click' }
        },
        required: ['selector']
      }
    },
    risky: true,
    execute: async (params) => {
      return await browserToolInstance.click(params.selector);
    }
  },

  browser_fill_form: {
    schema: {
      name: 'browser_fill_form',
      description: 'Fill a text input or form field on the current webpage.',
      input_schema: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS selector of the input field' },
          value: { type: 'string', description: 'Value to type into the field' }
        },
        required: ['selector', 'value']
      }
    },
    risky: true,
    execute: async (params) => {
      return await browserToolInstance.fillForm(params.selector, params.value);
    }
  },

  // --- Gmail Tools ---
  gmail_list_messages: {
    schema: {
      name: 'gmail_list_messages',
      description: 'Search and list emails from the user\'s Gmail account. Returns metadata and short snippets.',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Gmail search query (e.g., "is:unread", "from:boss@example.com")' },
          maxResults: { type: 'number', description: 'Max number of emails to return (default 5)' }
        }
      }
    },
    risky: false,
    execute: async (params) => {
      const { gmailListMessages } = require('./gmail');
      return await gmailListMessages(params);
    }
  },

  gmail_read_message: {
    schema: {
      name: 'gmail_read_message',
      description: 'Read the full body text of a specific Gmail message. Use this to summarize or read an email.',
      input_schema: {
        type: 'object',
        properties: {
          messageId: { type: 'string', description: 'The unique ID of the message to read.' }
        },
        required: ['messageId']
      }
    },
    risky: false,
    execute: async (params) => {
      const { gmailReadMessage } = require('./gmail');
      return await gmailReadMessage(params);
    }
  },

  gmail_send_message: {
    schema: {
      name: 'gmail_send_message',
      description: 'Send an email via Gmail to a specified recipient. REQUIRES USER APPROVAL.',
      input_schema: {
        type: 'object',
        properties: {
          to: { type: 'string', description: 'Recipient email address' },
          subject: { type: 'string', description: 'Email subject line' },
          body: { type: 'string', description: 'Plain text email body content' }
        },
        required: ['to', 'subject', 'body']
      }
    },
    risky: true,
    execute: async (params) => {
      const { gmailSendMessage } = require('./gmail');
      return await gmailSendMessage(params);
    }
  },

  // --- Google Calendar Tools ---
  calendar_list_events: {
    schema: {
      name: 'calendar_list_events',
      description: 'List upcoming events from Google Calendar.',
      input_schema: {
        type: 'object',
        properties: {
          maxResults: { type: 'number', description: 'Max number of events to return (default 10, max 25)' },
          calendarId: { type: 'string', description: 'Calendar ID to query (default: "primary")' },
          timeMin: { type: 'string', description: 'ISO 8601 start time filter (default: now)' }
        }
      }
    },
    risky: false,
    execute: async (params) => {
      const { calendarListEvents } = require('./calendar');
      return await calendarListEvents(params);
    }
  },

  calendar_create_event: {
    schema: {
      name: 'calendar_create_event',
      description: 'Create a new event in Google Calendar. REQUIRES USER APPROVAL.',
      input_schema: {
        type: 'object',
        properties: {
          summary: { type: 'string', description: 'Event title/summary' },
          description: { type: 'string', description: 'Optional event description' },
          location: { type: 'string', description: 'Optional event location' },
          startDateTime: { type: 'string', description: 'Start date-time in ISO 8601 format (e.g. 2025-01-15T10:00:00)' },
          endDateTime: { type: 'string', description: 'End date-time in ISO 8601 format (e.g. 2025-01-15T11:00:00)' },
          timeZone: { type: 'string', description: 'Optional IANA timezone (default: system timezone)' },
          calendarId: { type: 'string', description: 'Calendar ID (default: "primary")' }
        },
        required: ['summary', 'startDateTime', 'endDateTime']
      }
    },
    risky: true,
    execute: async (params) => {
      const { calendarCreateEvent } = require('./calendar');
      return await calendarCreateEvent(params);
    }
  }
};


/**
 * Get schemas for all registered tools to send to Claude API
 */
function getToolSchemas() {
  return Object.values(toolsRegistry).map(t => t.schema);
}

/**
 * Execute a tool call, routing risky tools through the Approval Gate
 */
async function executeToolCall(toolName, params, approvalGate) {
  const toolDef = toolsRegistry[toolName];
  if (!toolDef) {
    throw new Error(`Tool '${toolName}' is not registered.`);
  }

  if (toolDef.risky) {
    if (!approvalGate) {
      throw new Error(`Approval gate required to execute risky tool '${toolName}'.`);
    }
    // Route through Approval Gate
    return await approvalGate.requestApproval(toolName, params, toolDef.execute);
  } else {
    // Safe tool - execute directly without blocking
    try {
      const result = await toolDef.execute(params);
      return { success: true, result };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
}

/**
 * Register a new tool into the registry
 */
function registerTool(name, toolDef) {
  toolsRegistry[name] = toolDef;
}

module.exports = {
  toolsRegistry,
  getToolSchemas,
  executeToolCall,
  registerTool
};
