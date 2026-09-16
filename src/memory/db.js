const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Risk level constants used by ApprovalGate and MemoryManager pruning
const RISK_LEVELS = {
  SAFE: 0,     // auto/no approval needed
  LOW: 1,      // browser interaction (click, fill)
  MEDIUM: 2,   // email send, calendar write
  HIGH: 3      // reserved for future destructive actions
};

// Map tool names to their risk level for audit log
const TOOL_RISK_LEVELS = {
  dummy_safe_action: RISK_LEVELS.SAFE,
  browser_navigate: RISK_LEVELS.SAFE,
  browser_read_page: RISK_LEVELS.SAFE,
  gmail_list_messages: RISK_LEVELS.SAFE,
  calendar_list_events: RISK_LEVELS.SAFE,
  browser_click: RISK_LEVELS.LOW,
  browser_fill_form: RISK_LEVELS.LOW,
  dummy_risky_action: RISK_LEVELS.LOW,
  gmail_send_message: RISK_LEVELS.MEDIUM,
  calendar_create_event: RISK_LEVELS.MEDIUM,
  dangerous_system_wipe: RISK_LEVELS.HIGH
};

class AgentDatabase {
  constructor(dbPath) {
    this.dbPath = dbPath || path.join(__dirname, '../../agent_memory.db');

    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(this.dbPath);
    this.initTables();
    this.runMigrations();
  }

  initTables() {
    this.db.pragma('journal_mode = WAL');

    // ── Legacy tables (kept for backward compatibility) ──────────────────
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        description TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Audit log — CHECK constraint on decision, risk_level added via migration
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tool_name TEXT NOT NULL,
        params TEXT NOT NULL,
        decision TEXT NOT NULL CHECK(decision IN ('approved', 'declined')),
        outcome TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // ── Tiered memory tables ──────────────────────────────────────────────

    // Durable facts — slow-growing, high signal. Rarely pruned.
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_facts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        confidence REAL NOT NULL DEFAULT 0.7,
        source TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_accessed_at INTEGER,
        access_count INTEGER NOT NULL DEFAULT 0,
        UNIQUE(category, key)
      );
      CREATE INDEX IF NOT EXISTS idx_facts_category ON memory_facts(category);
    `);

    // Raw conversation turns — grows fast, summarized then deleted after TTL
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS conversation_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        archived INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_messages_session ON conversation_messages(session_id);
      CREATE INDEX IF NOT EXISTS idx_messages_created ON conversation_messages(created_at);
    `);

    // One-row summaries that replace a session's raw messages after pruning
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS session_summaries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL UNIQUE,
        summary TEXT NOT NULL,
        message_count INTEGER NOT NULL,
        start_ts INTEGER NOT NULL,
        end_ts INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);

    // Short-lived tool/web cache — always safe to wipe
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ephemeral_cache (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cache_key TEXT NOT NULL UNIQUE,
        payload TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
    `);

    // MemoryManager bookkeeping (last run timestamps, etc.)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS storage_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
  }

  /**
   * Safe schema migrations — add columns that may not exist on older DBs.
   * SQLite does not support IF NOT EXISTS on ALTER TABLE, so we use try/catch.
   */
  runMigrations() {
    // Add risk_level column to audit_log (migration for pre-existing DBs)
    try {
      this.db.exec('ALTER TABLE audit_log ADD COLUMN risk_level INTEGER NOT NULL DEFAULT 0');
    } catch {
      // Column already exists — safe to ignore
    }
  }

  // ── Legacy message API (used by orchestrator for live chat history) ──

  saveMessage(role, content) {
    const info = this.db.prepare('INSERT INTO messages (role, content) VALUES (?, ?)').run(role, content);
    return info.lastInsertRowid;
  }

  getMessages(limit = 100) {
    return this.db.prepare('SELECT id, role, content, timestamp FROM messages ORDER BY id ASC LIMIT ?').all(limit);
  }

  clearMessages() {
    return this.db.prepare('DELETE FROM messages').run();
  }

  // ── Audit log API ────────────────────────────────────────────────────

  logAudit(toolName, params, decision, outcome = null, riskLevel = null) {
    const paramsStr = typeof params === 'object' ? JSON.stringify(params) : String(params);
    const risk = riskLevel !== null ? riskLevel : (TOOL_RISK_LEVELS[toolName] ?? 0);
    const info = this.db.prepare(
      'INSERT INTO audit_log (tool_name, params, decision, outcome, risk_level) VALUES (?, ?, ?, ?, ?)'
    ).run(toolName, paramsStr, decision, outcome, risk);
    return info.lastInsertRowid;
  }

  updateAuditOutcome(id, outcome) {
    this.db.prepare('UPDATE audit_log SET outcome = ? WHERE id = ?').run(outcome, id);
  }

  getAuditLogs(limit = 100) {
    return this.db.prepare(
      'SELECT id, tool_name, params, decision, outcome, risk_level, timestamp FROM audit_log ORDER BY id DESC LIMIT ?'
    ).all(limit);
  }

  // ── Conversation messages API (session-tracked) ──────────────────────

  saveConversationMessage(sessionId, role, content) {
    const info = this.db.prepare(
      'INSERT INTO conversation_messages (session_id, role, content, created_at) VALUES (?, ?, ?, ?)'
    ).run(sessionId, role, content, Date.now());
    return info.lastInsertRowid;
  }

  getSessions() {
    // Get unique sessions, their start time, and use the first user message as title
    return this.db.prepare(`
      SELECT 
        session_id as id,
        MIN(created_at) as started_at,
        (SELECT content FROM conversation_messages cm2 
         WHERE cm2.session_id = cm.session_id AND role = 'user' 
         ORDER BY id ASC LIMIT 1) as title
      FROM conversation_messages cm
      GROUP BY session_id
      ORDER BY started_at DESC
    `).all();
  }

  getConversationMessages(sessionId) {
    return this.db.prepare(
      'SELECT id, role, content, created_at FROM conversation_messages WHERE session_id = ? ORDER BY id ASC'
    ).all(sessionId);
  }

  deleteSession(sessionId) {
    // Delete from both conversation_messages and session_summaries
    // Using a transaction to ensure both succeed
    const transaction = this.db.transaction(() => {
      this.db.prepare('DELETE FROM conversation_messages WHERE session_id = ?').run(sessionId);
      this.db.prepare('DELETE FROM session_summaries WHERE session_id = ?').run(sessionId);
    });
    transaction();
  }

  // ── Task operations ──────────────────────────────────────────────────

  saveTask(description, status = 'pending') {
    const info = this.db.prepare('INSERT INTO tasks (description, status) VALUES (?, ?)').run(description, status);
    return info.lastInsertRowid;
  }

  getTasks() {
    return this.db.prepare('SELECT id, description, status, created_at, updated_at FROM tasks ORDER BY id DESC').all();
  }

  updateTaskStatus(id, status) {
    return this.db.prepare('UPDATE tasks SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(status, id);
  }

  close() {
    if (this.db) this.db.close();
  }
}

module.exports = { AgentDatabase, TOOL_RISK_LEVELS, RISK_LEVELS };
