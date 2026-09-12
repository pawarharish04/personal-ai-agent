const { Anthropic } = require('@anthropic-ai/sdk');
const { AgentDatabase } = require('./memory/db');
const { getToolSchemas, executeToolCall } = require('./tools/index');

class Orchestrator {
  constructor(dbPath, approvalGate) {
    this.db = new AgentDatabase(dbPath);
    this.approvalGate = approvalGate;
    this.anthropic = null;
    this.systemPrompt = `You are a local-first personal AI assistant running as a desktop app.
Your role is to assist the user with web browsing, email, and calendar scheduling while respecting strict privacy and user approval rules.
When performing tasks with side-effects, use the provided tools. Be concise, direct, and helpful.`;

    this.initClient();
    this.loadHistoryFromDb();
  }

  setApprovalGate(approvalGate) {
    this.approvalGate = approvalGate;
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

    // 1. Persist user message
    this.db.saveMessage('user', userContent);
    this.messages.push({ role: 'user', content: userContent });

    let stepCount = 0;
    const maxSteps = 8;
    const tools = getToolSchemas();

    try {
      while (stepCount < maxSteps) {
        stepCount++;

        // Send request to Claude with available tools
        const response = await this.anthropic.messages.create({
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 2048,
          system: this.systemPrompt,
          messages: this.messages,
          tools: stepCount < maxSteps ? tools : undefined // Force plain text on step 8
        });

        // Add assistant message to history
        this.messages.push({ role: 'assistant', content: response.content });

        // Check for tool use
        const toolUseBlocks = response.content.filter(block => block.type === 'tool_use');

        if (toolUseBlocks.length === 0 || stepCount >= maxSteps) {
          // Final text response reached
          const finalContent = response.content
            .filter(c => c.type === 'text')
            .map(c => c.text)
            .join('\n');

          this.db.saveMessage('assistant', finalContent);

          return {
            role: 'assistant',
            content: finalContent
          };
        }

        // Execute tool calls
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

        // Add tool results as user role message for next turn
        this.messages.push({
          role: 'user',
          content: toolResults
        });
      }

      // Fallback response if loop finishes
      const lastMsg = this.messages[this.messages.length - 1];
      const textContent = typeof lastMsg.content === 'string' ? lastMsg.content : 'Task completed.';
      this.db.saveMessage('assistant', textContent);
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
}

module.exports = { Orchestrator };
