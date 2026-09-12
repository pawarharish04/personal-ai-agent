const { Anthropic } = require('@anthropic-ai/sdk');
const crypto = require('crypto');
const { AgentDatabase } = require('./memory/db');
const { MemoryManager } = require('./memory/memoryManager');
const { getToolSchemas, executeToolCall } = require('./tools/index');

class Orchestrator {
  constructor(dbPath, approvalGate) {
    this.db = new AgentDatabase(dbPath);
    this.dbPath = dbPath;
    this.approvalGate = approvalGate;
    this.anthropic = null;
    this.memoryManager = null;

    // Session ID for this app launch — used for conversation_messages tracking
    this.sessionId = crypto.randomUUID();

    this.initClient();
    this.loadHistoryFromDb();
    this.initMemoryManager();
  }

  initClient() {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (apiKey && apiKey !== 'your_anthropic_api_key_here') {
      this.anthropic = new Anthropic({ apiKey });
    } else {
      this.anthropic = null;
    }
  }

  initMemoryManager() {
    // Build the summarize function so MemoryManager can condense old sessions
    // using Claude without owning the Anthropic client itself.
    const summarize = this.anthropic
      ? async (messages) => {
          const text = messages
            .map(m => `${m.role}: ${m.content}`)
            .join('\n');
          const res = await this.anthropic.messages.create({
            model: 'claude-3-5-sonnet-20241022',
            max_tokens: 300,
            messages: [{
              role: 'user',
              content: `Summarize this conversation in 3-5 concise sentences, preserving important facts, user preferences, and outcomes:\n\n${text}`
            }]
          });
          return res.content.filter(c => c.type === 'text').map(c => c.text).join('');
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

    if (!this.anthropic) {
      return {
        role: 'assistant',
        content: '⚠️ **Anthropic API key is missing or invalid.**\n\nPlease add your `ANTHROPIC_API_KEY` to the `.env` file in the project root directory and restart the application.',
        error: 'MISSING_API_KEY'
      };
    }

    // Persist to both legacy messages table and session-tracked conversation table
    this.db.saveMessage('user', userContent);
    this.db.saveConversationMessage(this.sessionId, 'user', userContent);
    this.messages.push({ role: 'user', content: userContent });

    let stepCount = 0;
    const maxSteps = 8;
    const tools = getToolSchemas();

    try {
      while (stepCount < maxSteps) {
        stepCount++;

        const response = await this.anthropic.messages.create({
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 2048,
          system: this.buildSystemPrompt(),
          messages: this.messages,
          tools: stepCount < maxSteps ? tools : undefined
        });

        this.messages.push({ role: 'assistant', content: response.content });

        const toolUseBlocks = response.content.filter(block => block.type === 'tool_use');

        if (toolUseBlocks.length === 0 || stepCount >= maxSteps) {
          const finalContent = response.content
            .filter(c => c.type === 'text')
            .map(c => c.text)
            .join('\n');

          this.db.saveMessage('assistant', finalContent);
          this.db.saveConversationMessage(this.sessionId, 'assistant', finalContent);

          return { role: 'assistant', content: finalContent };
        }

        const toolResults = [];
        for (const toolUse of toolUseBlocks) {
          const { id, name, input } = toolUse;
          const toolResult = await executeToolCall(name, input, this.approvalGate);

          toolResults.push({
            type: 'tool_result',
            tool_use_id: id,
            content: JSON.stringify(toolResult)
          });
        }

        this.messages.push({ role: 'user', content: toolResults });
      }

      const lastMsg = this.messages[this.messages.length - 1];
      const textContent = typeof lastMsg.content === 'string' ? lastMsg.content : 'Task completed.';
      this.db.saveMessage('assistant', textContent);
      this.db.saveConversationMessage(this.sessionId, 'assistant', textContent);
      return { role: 'assistant', content: textContent };

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
