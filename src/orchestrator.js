const { Anthropic } = require('@anthropic-ai/sdk');
const { AgentDatabase } = require('./memory/db');
require('dotenv').config();

class Orchestrator {
  constructor(dbPath) {
    this.db = new AgentDatabase(dbPath);
    this.anthropic = null;
    this.systemPrompt = `You are a local-first personal AI assistant running as a desktop app.
Your role is to assist the user with web browsing, email, and calendar scheduling while respecting strict privacy and user approval rules.
Provide helpful, concise, and accurate responses.`;
    
    this.initClient();
    this.loadHistoryFromDb();
  }

  initClient() {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (apiKey && apiKey !== 'your_anthropic_api_key_here') {
      this.anthropic = new Anthropic({ apiKey });
    } else {
      this.anthropic = null;
    }
  }

  loadHistoryFromDb() {
    const storedMessages = this.db.getMessages();
    this.messages = storedMessages.map(msg => ({
      role: msg.role,
      content: msg.content
    }));
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

    // 1. Persist user message to SQLite & memory
    this.db.saveMessage('user', userContent);
    this.messages.push({ role: 'user', content: userContent });

    try {
      // 2. Call Claude API with persistent message history
      const response = await this.anthropic.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 2048,
        system: this.systemPrompt,
        messages: this.messages
      });

      const assistantText = response.content
        .filter(c => c.type === 'text')
        .map(c => c.text)
        .join('\n');

      // 3. Persist assistant message to SQLite & memory
      this.db.saveMessage('assistant', assistantText);
      this.messages.push({ role: 'assistant', content: assistantText });

      return {
        role: 'assistant',
        content: assistantText
      };
    } catch (err) {
      console.error('Claude API Error:', err);
      return {
        role: 'assistant',
        content: `⚠️ **Error communicating with Claude API:** ${err.message}`,
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
}

module.exports = { Orchestrator };
