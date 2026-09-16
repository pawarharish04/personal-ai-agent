const Groq = require('groq-sdk');
const crypto = require('crypto');
const { AgentDatabase } = require('./memory/db');
const { MemoryManager } = require('./memory/memoryManager');
const { getToolSchemas, executeToolCall } = require('./tools/index');

class Orchestrator {
  constructor(dbPath, approvalGate) {
    this.db = new AgentDatabase(dbPath);
    this.dbPath = dbPath;
    this.approvalGate = approvalGate;
    this.groq = null;
    this.memoryManager = null;

    // Session ID for this app launch — used for conversation_messages tracking
    this.sessionId = crypto.randomUUID();

    this.initClient();
    this.loadHistoryFromDb();
    this.initMemoryManager();
  }

  initClient() {
    const apiKey = process.env.GROQ_API_KEY;
    if (apiKey) {
      this.groq = new Groq({ apiKey });
    } else {
      this.groq = null;
    }
  }

  initMemoryManager() {
    // Build the summarize function so MemoryManager can condense old sessions
    // using Groq without owning the client itself.
    const summarize = this.groq
      ? async (messages) => {
          const text = messages
            .map(m => `${m.role}: ${m.content}`)
            .join('\n');
          const res = await this.groq.chat.completions.create({
            model: 'openai/gpt-oss-120b',
            max_tokens: 300,
            messages: [{
              role: 'user',
              content: `Summarize this conversation in 3-5 concise sentences, preserving important facts, user preferences, and outcomes:\n\n${text}`
            }]
          });
          return res.choices[0]?.message?.content || '';
        }
      : undefined;

    this.memoryManager = new MemoryManager(this.db.db, this.dbPath, { summarize });
  }

  setApprovalGate(approvalGate) {
    this.approvalGate = approvalGate;
  }

  loadHistoryFromDb() {
    const storedMessages = this.db.getMessages();
    this.messages = storedMessages.map(msg => ({
      role: msg.role,
      content: msg.content
    }));
  }

  /**
   * Build a dynamic system prompt that injects relevant remembered facts.
   */
  buildSystemPrompt() {
    const now = new Date();
    let base = `You are a local-first personal AI assistant running as a desktop app.
The current date and time is: ${now.toLocaleString()} (${now.toISOString()}).
Your role is to help the user with web browsing, search, email, and calendar tasks while respecting strict privacy and approval rules.

TOOL USAGE RULES:
1. For any question involving current events, live data, scores, weather, coding challenges, news, or specific facts you are not certain of — ALWAYS call web_search FIRST. Never guess or make up specifics.
2. After web_search: Synthesize your answer IMMEDIATELY using the provided search snippets and cite the URLs. Do NOT call browser_navigate unless the user explicitly requested you to visit or read a specific webpage.
3. NEVER fabricate a specific fact (date, problem name, score, weather reading, etc.) that should come from a real source. If search doesn't yield a confident answer, say so honestly.
4. For email tasks, use gmail_list_messages to find emails, then gmail_read_message to read the full body before summarizing.
5. For calendar tasks, always use the correct ISO 8601 date/time format.
6. When performing tasks with side-effects (send email, create calendar event), use the provided tools and wait for user approval.`;

    // Inject top facts/preferences if any exist
    try {
      const facts = this.memoryManager
        ? this.memoryManager.getRelevantFacts(['preference', 'person', 'project', 'goal'], 10)
        : [];

      if (facts.length > 0) {
        const factLines = facts.map(f => `- [${f.category}] ${f.key}: ${f.value}`).join('\n');
        base += `\n\nRemembered context about the user:\n${factLines}`;
      }
    } catch (err) {
      // Non-fatal — facts are enhancement, not critical path
    }

    return base;
  }

  getSafeRecentMessages(limit = 8) {
    let slice = this.messages.slice(-limit);
    while (slice.length > 0 && slice[0].role === 'tool') {
      const idx = this.messages.indexOf(slice[0]);
      if (idx > 0) {
        slice.unshift(this.messages[idx - 1]);
      } else {
        slice.shift();
      }
    }
    return slice;
  }

  async handleUserMessage(userContent) {
    this.initClient();

    if (!this.groq) {
      return {
        role: 'assistant',
        content: '⚠️ **Groq API key is missing or invalid.**\n\nPlease add your `GROQ_API_KEY` to the `.env` file in the project root directory and restart the application.',
        error: 'MISSING_API_KEY'
      };
    }

    // Persist to both legacy messages table and session-tracked conversation table
    this.db.saveMessage('user', userContent);
    this.db.saveConversationMessage(this.sessionId, 'user', userContent);
    this.messages.push({ role: 'user', content: userContent });

    let stepCount = 0;
    const maxSteps = 6;
    const tools = getToolSchemas().map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema
      }
    }));

    try {
      while (stepCount < maxSteps) {
        stepCount++;

        const recentMessages = this.getSafeRecentMessages(8);
        const apiMessages = [
          { role: 'system', content: this.buildSystemPrompt() },
          ...recentMessages
        ];

        const activeTools = tools.length > 0 ? tools : undefined;

        let response;
        try {
          response = await this.groq.chat.completions.create({
            model: 'openai/gpt-oss-120b',
            max_tokens: 1024,
            messages: apiMessages,
            tools: activeTools,
            tool_choice: 'auto'
          });
        } catch (callErr) {
          if (callErr.status === 400 && callErr.message && 
              (callErr.message.includes('tool call validation failed') || callErr.message.includes('Tool choice is none'))) {
            console.warn('Recovering from Groq tool validation error by synthesizing directly...');
            break;
          }
          throw callErr;
        }

        const responseMessage = response.choices[0].message;
        
        // Push the assistant's message (which may contain tool_calls) to our history
        this.messages.push(responseMessage);

        const toolCalls = responseMessage.tool_calls;

        if (!toolCalls || toolCalls.length === 0) {
          const finalContent = responseMessage.content || '';

          this.db.saveMessage('assistant', finalContent);
          this.db.saveConversationMessage(this.sessionId, 'assistant', finalContent);

          return { role: 'assistant', content: finalContent };
        }

        // Handle tool calls
        for (const toolCall of toolCalls) {
          const { id, function: fn } = toolCall;
          const { name, arguments: args } = fn;
          
          let parsedArgs = {};
          try {
            parsedArgs = JSON.parse(args);
          } catch(e) {
            console.error('Failed to parse tool args', e);
          }
          
          const toolResult = await executeToolCall(name, parsedArgs, this.approvalGate);

          let resultString = JSON.stringify(toolResult);
          if (resultString.length > 2000) {
            resultString = resultString.substring(0, 2000) + '... [truncated for length]';
          }

          this.messages.push({
            role: 'tool',
            tool_call_id: id,
            name: name,
            content: resultString
          });
        }
      }

      // If loop exited because maxSteps reached, perform a final synthesis call to produce a real answer
      try {
        const finalPromptMessages = [
          { role: 'system', content: this.buildSystemPrompt() },
          ...this.getSafeRecentMessages(8),
          { role: 'user', content: 'Synthesize and answer my question directly based on all the information gathered above. Do not call any tools.' }
        ];
        const finalResponse = await this.groq.chat.completions.create({
          model: 'openai/gpt-oss-120b',
          max_tokens: 1024,
          messages: finalPromptMessages
        });
        const finalContent = finalResponse.choices[0]?.message?.content || 'I gathered information but could not formulate a complete answer. Please try asking again.';
        this.db.saveMessage('assistant', finalContent);
        this.db.saveConversationMessage(this.sessionId, 'assistant', finalContent);
        return { role: 'assistant', content: finalContent };
      } catch (synthErr) {
        console.error('Final synthesis error:', synthErr);
        const finalContent = 'I completed the search but encountered an error synthesizing the final response. Please try asking again.';
        this.db.saveMessage('assistant', finalContent);
        this.db.saveConversationMessage(this.sessionId, 'assistant', finalContent);
        return { role: 'assistant', content: finalContent };
      }

    } catch (err) {
      console.error('Orchestrator Loop Error:', err);
      return {
        role: 'assistant',
        content: `⚠️ **Error during execution:** ${err.message}`,
        error: err.message
      };
    }
  }

  getHistory() {
    return this.db.getMessages();
  }

  clearHistory() {
    this.db.clearMessages();
    this.messages = [];
    const crypto = require('crypto');
    this.sessionId = crypto.randomUUID();
  }

  getSessions() {
    return this.db.getSessions();
  }

  loadSession(sessionId) {
    this.sessionId = sessionId;
    
    // Clear short-term context window
    this.db.clearMessages();
    
    // Fetch historical messages for this session
    const historicalMessages = this.db.getConversationMessages(sessionId);
    
    // Restore the short-term context window (last 20 messages to balance context limit)
    const recentMessages = historicalMessages.slice(-20);
    this.messages = [];
    
    for (const msg of recentMessages) {
      if (msg.role !== 'tool') { // Just a sanity check, though we save tools differently if needed
        this.db.saveMessage(msg.role, msg.content);
        this.messages.push({ role: msg.role, content: msg.content });
      }
    }
    
    return historicalMessages; // Return the full history to render in the UI
  }

  deleteSession(sessionId) {
    this.db.deleteSession(sessionId);
    
    const wasActive = (this.sessionId === sessionId);
    if (wasActive) {
      this.db.clearMessages();
      this.messages = [];
      const crypto = require('crypto');
      this.sessionId = crypto.randomUUID();
    }
    
    return { success: true, wasActive };
  }

  getAuditLogs() {
    return this.db.getAuditLogs();
  }

  getStorageHealth() {
    return this.memoryManager
      ? this.memoryManager.checkStorageHealth()
      : { status: 'ok', usedMB: 0, softCapMB: 400, hardCapMB: 800 };
  }

  async runMaintenance() {
    if (!this.memoryManager) return null;
    return await this.memoryManager.runMaintenance();
  }

  upsertFact(factData) {
    if (this.memoryManager) this.memoryManager.upsertFact(factData);
  }
}

module.exports = { Orchestrator };
