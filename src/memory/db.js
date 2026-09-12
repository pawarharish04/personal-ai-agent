const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

class AgentDatabase {
  constructor(dbPath) {
    // Default to app root or user data directory
    this.dbPath = dbPath || path.join(__dirname, '../../agent_memory.db');
    
    // Ensure parent directory exists
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(this.dbPath);
    this.initTables();
  }

  initTables() {
    // Enable WAL mode for better concurrency and performance
    this.db.pragma('journal_mode = WAL');

    // 1. Messages table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 2. Tasks table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        description TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 3. Audit Log table with strict CHECK constraint
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
  }

  // --- Message operations ---
  saveMessage(role, content) {
    const stmt = this.db.prepare(
      'INSERT INTO messages (role, content) VALUES (?, ?)'
    );
    const info = stmt.run(role, content);
    return info.lastInsertRowid;
  }

  getMessages(limit = 100) {
    const stmt = this.db.prepare(
      'SELECT id, role, content, timestamp FROM messages ORDER BY id ASC LIMIT ?'
    );
    return stmt.all(limit);
  }

  clearMessages() {
    const stmt = this.db.prepare('DELETE FROM messages');
    return stmt.run();
  }

  // --- Audit Log operations ---
  logAudit(toolName, params, decision, outcome = null) {
    const paramsStr = typeof params === 'object' ? JSON.stringify(params) : String(params);
    const stmt = this.db.prepare(
      'INSERT INTO audit_log (tool_name, params, decision, outcome) VALUES (?, ?, ?, ?)'
    );
    const info = stmt.run(toolName, paramsStr, decision, outcome);
    return info.lastInsertRowid;
  }

  getAuditLogs(limit = 100) {
    const stmt = this.db.prepare(
      'SELECT id, tool_name, params, decision, outcome, timestamp FROM audit_log ORDER BY id DESC LIMIT ?'
    );
    return stmt.all(limit);
  }

  // --- Task operations ---
  saveTask(description, status = 'pending') {
    const stmt = this.db.prepare(
      'INSERT INTO tasks (description, status) VALUES (?, ?)'
    );
    const info = stmt.run(description, status);
    return info.lastInsertRowid;
  }

  getTasks() {
    const stmt = this.db.prepare(
      'SELECT id, description, status, created_at, updated_at FROM tasks ORDER BY id DESC'
    );
    return stmt.all();
  }

  updateTaskStatus(id, status) {
    const stmt = this.db.prepare(
      'UPDATE tasks SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    );
    return stmt.run(status, id);
  }

  close() {
    if (this.db) {
      this.db.close();
    }
  }
}

module.exports = { AgentDatabase };
