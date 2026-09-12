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
            model: 'openai/gpt-oss-20b',
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
    let base = `You are a local-first personal AI assistant running as a desktop app.
Your role is to assist the user with web browsing, email, and calendar scheduling while respecting strict privacy and user approval rules.
When performing tasks with side-effects, use the provided tools. Be concise, direct, and helpful.`;

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
    const maxSteps = 8;
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

        const apiMessages = [
          { role: 'system', content: this.buildSystemPrompt() },
          ...this.messages
        ];

        const response = await this.groq.chat.completions.create({
          model: 'openai/gpt-oss-20b',
          max_tokens: 2048,
          messages: apiMessages,
          tools: stepCount < maxSteps && tools.length > 0 ? tools : undefined,
          tool_choice: 'auto'
        });

        const responseMessage = response.choices[0].message;
        
        // Push the assistant's message (which may contain tool_calls) to our history
        this.messages.push(responseMessage);

        const toolCalls = responseMessage.tool_calls;

        if (!toolCalls || toolCalls.length === 0 || stepCount >= maxSteps) {
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

          this.messages.push({
            role: 'tool',
            tool_call_id: id,
            name: name,
            content: JSON.stringify(toolResult)
          });
        }
      }

      // If maxSteps reached without returning
      const finalContent = 'Task completed (max steps reached).';
      this.db.saveMessage('assistant', finalContent);
      this.db.saveConversationMessage(this.sessionId, 'assistant', finalContent);
      return { role: 'assistant', content: finalContent };

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
