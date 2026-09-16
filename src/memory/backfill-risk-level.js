const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');
const { TOOL_RISK_LEVELS } = require('./db');

function runBackfill() {
  const dbPath = process.env.AGENT_DB_PATH || path.join(
    process.env.APPDATA || os.homedir(),
    'Electron',
    'agent_memory.db'
  );

  console.log(`Connecting to database at: ${dbPath}`);
  let db;
  try {
    db = new Database(dbPath);
  } catch (err) {
    console.error(`Failed to open database at ${dbPath}:`, err.message);
    process.exit(1);
  }

  // Verify audit_log table exists
  const tableCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='audit_log'").get();
  if (!tableCheck) {
    console.log("audit_log table does not exist yet. Nothing to backfill.");
    db.close();
    return;
  }

  const rows = db.prepare('SELECT id, tool_name, risk_level FROM audit_log').all();
  console.log(`Found ${rows.length} rows in audit_log.`);

  let updatedCount = 0;
  const updateStmt = db.prepare('UPDATE audit_log SET risk_level = ? WHERE id = ?');

  const backfillTx = db.transaction(() => {
    for (const row of rows) {
      const derivedRisk = TOOL_RISK_LEVELS[row.tool_name] ?? 0;
      if (row.risk_level !== derivedRisk) {
        updateStmt.run(derivedRisk, row.id);
        updatedCount++;
      }
    }
  });

  backfillTx();

  console.log(`Backfill complete. Updated risk_level for ${updatedCount} / ${rows.length} rows.`);
  db.close();
}

if (require.main === module) {
  runBackfill();
}

module.exports = { runBackfill };
