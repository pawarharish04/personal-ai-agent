/**
 * Step 7 - Calendar Tool End-to-End Test
 * Run with: npm run calendar:test
 *
 * Requires: Google OAuth tokens already saved from `npm run oauth:test`
 * Tests:
 *   1. calendar_list_events (safe - no approval needed)
 *   2. calendar_create_event (risky - uses auto-approve mock + verifies audit log)
 */
const { app, BrowserWindow } = require('electron');
const path = require('path');
const { AgentDatabase } = require('../memory/db');
const { ApprovalGate } = require('../approval/gate');
const { executeToolCall } = require('./index');

require('dotenv').config({ path: path.join(__dirname, '../../.env') });

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false });
  const tokensPath = path.join(app.getPath('userData'), 'tokens.enc');
  const testDbPath = path.join(app.getPath('userData'), 'test_calendar_step7.db');

  const db = new AgentDatabase(testDbPath);
  let approvalCount = 0;

  const mockWindow = {
    webContents: {
      send: (channel, data) => {
        if (channel === 'approval:request') {
          approvalCount++;
          console.log(`\n[Approval Gate] Intercepted risky tool: ${data.toolName}`);
          console.log('[Approval Gate] Params:', JSON.stringify(data.params, null, 2));
          console.log('[Approval Gate] AUTO-APPROVING for test...\n');
          setTimeout(() => gate.handleUserResponse(data.id, true), 10);
        }
      }
    }
  };
  const gate = new ApprovalGate(db, () => mockWindow);

  console.log('\n=======================================================');
  console.log('  Step 7 - Calendar Tool Tests');
  console.log('=======================================================');
  console.log('Tokens file:', tokensPath);
  const fs = require('fs');
  if (!fs.existsSync(tokensPath)) {
    console.error('\n✘ No tokens.enc found. Run `npm run oauth:test` first to authenticate.');
    process.exit(1);
  }

  try {
    // ----- Test 1: calendar_list_events (Safe) -----
    console.log('\n[TEST 1] calendar_list_events (safe - no approval required)');
    const listRes = await executeToolCall('calendar_list_events', { maxResults: 5 }, gate);
    console.log('Result:', JSON.stringify(listRes, null, 2));

    if (!listRes.success) throw new Error(`calendar_list_events failed: ${listRes.error}`);
    console.log(`✔ Listed ${listRes.result.count} upcoming event(s).`);

    // Confirm no audit log entry for safe tool
    const logsBefore = db.getAuditLogs();
    if (logsBefore.some(l => l.tool_name === 'calendar_list_events')) {
      throw new Error('Safe tool should NOT create an audit log entry!');
    }
    console.log('✔ Confirmed: safe tool does not create audit log entry.');

    // ----- Test 2: calendar_create_event (Risky) -----
    console.log('\n[TEST 2] calendar_create_event (risky - requires approval)');

    // Create a test event 1 day from now, 1 hour long
    const start = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const end = new Date(start.getTime() + 60 * 60 * 1000);

    const createRes = await executeToolCall('calendar_create_event', {
      summary: 'Personal AI Agent Test Event',
      description: 'Created by Step 7 calendar tool test. Safe to delete.',
      startDateTime: start.toISOString(),
      endDateTime: end.toISOString()
    }, gate);

    console.log('Create result:', JSON.stringify(createRes, null, 2));
    if (!createRes.success) throw new Error(`calendar_create_event failed: ${createRes.error || JSON.stringify(createRes)}`);
    console.log(`✔ Event created: "${createRes.result.summary}" — ${createRes.result.htmlLink}`);

    if (approvalCount !== 1) throw new Error('Approval gate was not triggered for create event!');
    console.log('✔ Approval gate was triggered and auto-approved.');

    // Verify audit log
    const logsAfter = db.getAuditLogs();
    const createLog = logsAfter.find(l => l.tool_name === 'calendar_create_event');
    if (!createLog || createLog.decision !== 'approved' || createLog.outcome !== 'success') {
      throw new Error('Audit log entry for calendar_create_event is missing or incorrect!');
    }
    console.log('✔ Audit log entry verified:', createLog);

    console.log('\n🎉 ALL STEP 7 CALENDAR TESTS PASSED!');
    console.log('The Calendar tool is ready. Check your Google Calendar to see the test event.\n');

  } catch (err) {
    console.error('\n✘ Test failed:', err.message);
    process.exit(1);
  } finally {
    db.close();
    const fs = require('fs');
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    win.close();
    app.quit();
  }
});
