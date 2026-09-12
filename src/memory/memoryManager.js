// memoryManager.js
//
// Tiered memory management for the Personal AI Agent.
// Manages storage growth across five tables with different retention policies:
//   - memory_facts:           durable, slow-growing, evicted by score
//   - conversation_messages:  fast-growing raw turns, summarized then deleted
//   - session_summaries:      one-row condensed replacement per pruned session
//   - audit_log:              risk-tiered retention (60 days routine, 365 dangerous)
//   - ephemeral_cache:        TTL-based, always safe to wipe
//
// Assumes better-sqlite3 (synchronous) since that's what this project uses.
// Pass the raw db instance (agentDb.db), not the AgentDatabase wrapper.
//
// Wire-up (main.js):
//   const manager = new MemoryManager(orchestrator.db.db, dbPath, { summarize: claudeSummarize });
//   await manager.runMaintenance();          // call on app start + daily
//   manager.checkStorageHealth();            // call for settings/dashboard banner
//   manager.upsertFact({...});               // call from memory-extraction step
//   manager.getRelevantFacts(['preference']) // call before building Claude prompt

const fs = require('fs');

const RETENTION_POLICY = {
  softCapBytes: 400 * 1024 * 1024,   // 400 MB — start pruning aggressively
  hardCapBytes: 800 * 1024 * 1024,   // 800 MB — caller should warn user
  rawMessageTtlDays: 30,             // raw turns older than this get summarized+deleted
  auditRoutineTtlDays: 60,           // risk_level 0-1
  auditDangerousTtlDays: 365,        // risk_level 2-3 (accountability trail)
  cacheTtlDays: 7,
  maxFacts: 2000,                    // fact table eviction ceiling
};

class MemoryManager {
  constructor(db, dbPath, { summarize } = {}) {
    // db: raw better-sqlite3 Database instance
    // summarize: async (messages: {role, content, created_at}[]) => Promise<string>
    //            Inject so this module doesn't own a Claude client itself.
    this.db = db;
    this.dbPath = dbPath;
    this.summarize = summarize;
  }

  // ── Introspection ─────────────────────────────────────────────────────

  getDbSizeBytes() {
    try {
      return fs.statSync(this.dbPath).size;
    } catch {
      return 0;
    }
  }

  getStorageStats() {
    const tables = ['memory_facts', 'conversation_messages', 'session_summaries', 'audit_log', 'ephemeral_cache'];
    const stats = {};
    for (const t of tables) {
      try {
        stats[t] = this.db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
      } catch {
        stats[t] = 0;
      }
    }
    stats.dbSizeBytes = this.getDbSizeBytes();
    return stats;
  }

  /**
   * Storage health check — wire this result to a settings/dashboard banner.
   * Returns status + human-readable MB values ready for display.
   */
  checkStorageHealth(policy = RETENTION_POLICY) {
    const bytes = this.getDbSizeBytes();
    let status = 'ok';
    if (bytes >= policy.hardCapBytes)          status = 'over_hard_cap';
    else if (bytes >= policy.softCapBytes)     status = 'over_soft_cap';
    else if (bytes >= policy.softCapBytes * 0.75) status = 'approaching_limit';

    return {
      status,       // 'ok' | 'approaching_limit' | 'over_soft_cap' | 'over_hard_cap'
      usedMB: Math.round(bytes / 1024 / 1024),
      softCapMB: Math.round(policy.softCapBytes / 1024 / 1024),
      hardCapMB: Math.round(policy.hardCapBytes / 1024 / 1024),
    };
  }

  // ── Main entry point ──────────────────────────────────────────────────
  // Call on app startup and on a recurring timer (e.g. once per day).

  async runMaintenance(policy = RETENTION_POLICY) {
    const beforeBytes = this.getDbSizeBytes();

    this._expireCache(policy.cacheTtlDays);
    this._pruneAuditLogs(policy);
    await this._summarizeOldSessions(policy.rawMessageTtlDays);
    this._pruneFactsIfOverLimit(policy.maxFacts);

    // Still over soft cap after normal pruning? Tighten windows and go again
    // rather than jumping to deleting facts or blocking writes.
    if (this.getDbSizeBytes() > policy.softCapBytes) {
      await this._summarizeOldSessions(Math.max(7, Math.floor(policy.rawMessageTtlDays / 2)));
      this._pruneAuditLogs({
        ...policy,
        auditRoutineTtlDays: Math.max(14, Math.floor(policy.auditRoutineTtlDays / 2))
      });
    }

    this._vacuum();
    this._setMeta('last_maintenance_run', new Date().toISOString());

    const afterBytes = this.getDbSizeBytes();
    return {
      beforeBytes,
      afterBytes,
      reclaimedBytes: beforeBytes - afterBytes,
      // Deliberately does NOT auto-delete facts or block writes at hard cap.
      // Callers must surface this flag in the UI and let the user decide.
      overHardCap: afterBytes > policy.hardCapBytes,
    };
  }

  // ── Pruning steps ─────────────────────────────────────────────────────

  _expireCache(ttlDays) {
    const cutoff = Date.now() - ttlDays * 86400000;
    this.db.prepare('DELETE FROM ephemeral_cache WHERE expires_at < ?').run(Date.now());
    this.db.prepare('DELETE FROM ephemeral_cache WHERE created_at < ?').run(cutoff);
  }

  _pruneAuditLogs(policy) {
    const routineCutoff   = Date.now() - policy.auditRoutineTtlDays   * 86400000;
    const dangerousCutoff = Date.now() - policy.auditDangerousTtlDays * 86400000;
    this.db.prepare('DELETE FROM audit_log WHERE risk_level < 2 AND created_at < ?').run(routineCutoff);
    this.db.prepare('DELETE FROM audit_log WHERE risk_level >= 2 AND created_at < ?').run(dangerousCutoff);
  }

  async _summarizeOldSessions(ttlDays) {
    const cutoff = Date.now() - ttlDays * 86400000;
    let staleSessions;
    try {
      staleSessions = this.db.prepare(`
        SELECT DISTINCT session_id FROM conversation_messages
        WHERE created_at < ? AND archived = 0
      `).all(cutoff);
    } catch {
      return; // Table may not exist on very old DBs — safe to skip
    }

    for (const { session_id } of staleSessions) {
      const messages = this.db.prepare(`
        SELECT role, content, created_at FROM conversation_messages
        WHERE session_id = ? ORDER BY created_at ASC
      `).all(session_id);
      if (messages.length === 0) continue;

      const existingSummary = this.db.prepare(
        'SELECT id FROM session_summaries WHERE session_id = ?'
      ).get(session_id);

      if (!existingSummary && this.summarize) {
        try {
          const summaryText = await this.summarize(messages);
          this.db.prepare(`
            INSERT INTO session_summaries
              (session_id, summary, message_count, start_ts, end_ts, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
          `).run(
            session_id, summaryText, messages.length,
            messages[0].created_at, messages[messages.length - 1].created_at,
            Date.now()
          );
        } catch (err) {
          console.warn('[MemoryManager] Summarization failed for session', session_id, err.message);
          // Flag as archived instead of losing content
          this.db.prepare(
            'UPDATE conversation_messages SET archived = 1 WHERE session_id = ?'
          ).run(session_id);
          continue;
        }
      }

      // Only delete raw messages once a summary exists.
      // If no summarizer provided, flag archived — NEVER silently drop context.
      const hasSummary = existingSummary || (this.summarize !== undefined);
      if (hasSummary) {
        this.db.prepare('DELETE FROM conversation_messages WHERE session_id = ?').run(session_id);
      } else {
        this.db.prepare(
          'UPDATE conversation_messages SET archived = 1 WHERE session_id = ?'
        ).run(session_id);
      }
    }
  }

  _pruneFactsIfOverLimit(maxFacts) {
    let count;
    try {
      count = this.db.prepare('SELECT COUNT(*) AS n FROM memory_facts').get().n;
    } catch {
      return; // Table not yet populated
    }
    if (count <= maxFacts) return;

    const overflow = count - maxFacts;
    const candidates = this.db.prepare(`
      SELECT id, confidence, access_count, last_accessed_at, created_at FROM memory_facts
    `).all();

    const now = Date.now();
    // Lower score = less valuable = evicted first.
    // Rewards confidence and usage; penalizes staleness.
    const score = (f) => {
      const ageDays = (now - (f.last_accessed_at || f.created_at)) / 86400000;
      return f.confidence + Math.log((f.access_count || 0) + 1) * 0.1 - ageDays * 0.001;
    };
    candidates.sort((a, b) => score(a) - score(b));

    const toDelete = candidates.slice(0, overflow).map(c => c.id);
    const del = this.db.prepare('DELETE FROM memory_facts WHERE id = ?');
    this.db.transaction((ids) => { for (const id of ids) del.run(id); })(toDelete);
  }

  _vacuum() {
    this.db.exec('VACUUM');
  }

  _setMeta(key, value) {
    this.db.prepare(`
      INSERT INTO storage_meta (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(key, value, Date.now());
  }

  // ── Fact read/write API ───────────────────────────────────────────────
  // Called during normal operation, not just maintenance.

  upsertFact({ category, key, value, confidence = 0.7, source = null }) {
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO memory_facts (category, key, value, confidence, source, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(category, key) DO UPDATE SET
        value      = excluded.value,
        confidence = MAX(memory_facts.confidence, excluded.confidence),
        source     = excluded.source,
        updated_at = excluded.updated_at
    `).run(category, key, value, confidence, source, now, now);
  }

  /**
   * Pull relevant facts to inject into the Claude system prompt.
   * Filters by category when given (e.g. ['preference', 'project']).
   * Updates access stats so frequently-used facts survive eviction longer.
   */
  getRelevantFacts(categories = [], limit = 20) {
    let rows;
    try {
      if (categories.length) {
        const placeholders = categories.map(() => '?').join(',');
        rows = this.db.prepare(`
          SELECT * FROM memory_facts WHERE category IN (${placeholders})
          ORDER BY confidence DESC, updated_at DESC LIMIT ?
        `).all(...categories, limit);
      } else {
        rows = this.db.prepare(`
          SELECT * FROM memory_facts ORDER BY confidence DESC, updated_at DESC LIMIT ?
        `).all(limit);
      }
    } catch {
      return [];
    }

    // Touch access stats so frequently-used facts survive eviction longer
    const now = Date.now();
    const touch = this.db.prepare(
      'UPDATE memory_facts SET last_accessed_at = ?, access_count = access_count + 1 WHERE id = ?'
    );
    this.db.transaction((ids) => { for (const id of ids) touch.run(now, id); })(rows.map(r => r.id));

    return rows;
  }
}

module.exports = { MemoryManager, RETENTION_POLICY };
