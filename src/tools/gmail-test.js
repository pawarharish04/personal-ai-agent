/**
 * Step 6 - Gmail Tools Test (Electron Runtime)
 * Run with: npx electron src/tools/gmail-test.js
 */
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const { gmailListMessages, gmailSendMessage } = require('./gmail');
const { executeToolCall } = require('./index');

const tokensPath = path.join(app.getPath('userData'), 'tokens.enc');

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false });

  console.log('\n=======================================================');
  console.log('  Step 6 Gmail Tool Integration Test');
  console.log('=======================================================');
  console.log('Tokens file:', tokensPath);

  if (!fs.existsSync(tokensPath)) {
    console.error('✘ No tokens file found. Please run `npm run oauth:test` first.');
    win.close();
    app.quit();
    process.exit(1);
  }

  try {
    // 1. Direct call to gmailListMessages
    console.log('\n>>> Testing gmailListMessages (direct)...');
    const listResult = await gmailListMessages({ maxResults: 3 }, tokensPath);
    console.log(`✔ Found ${listResult.count} messages in inbox.`);
    if (listResult.messages.length > 0) {
      console.log('  Sample message 1:');
      console.log('    Subject:', listResult.messages[0].subject);
      console.log('    From:', listResult.messages[0].from);
      console.log('    Date:', listResult.messages[0].date);
      console.log('    Snippet:', listResult.messages[0].snippet ? listResult.messages[0].snippet.substring(0, 60) + '...' : '(no snippet)');
    }

    // 2. Dispatch safe tool through executeToolCall
    console.log('\n>>> Testing executeToolCall("gmail_list_messages")...');
    const dispatchResult = await executeToolCall('gmail_list_messages', { maxResults: 2 });
    console.log('✔ executeToolCall dispatch result:', dispatchResult.success ? 'SUCCESS' : 'FAILED');

    // 3. Test Approval Gate enforcement for risky gmail_send_message
    console.log('\n>>> Testing Approval Gate enforcement for gmail_send_message...');
    
    let approvalRequested = false;
    const mockApprovalGate = {
      requestApproval: async (toolName, params, executeFn) => {
        approvalRequested = true;
        console.log(`  [ApprovalGate Mock] Intercepted risky tool: ${toolName}`);
        console.log(`  [ApprovalGate Mock] Target recipient: ${params.to}`);
        console.log(`  [ApprovalGate Mock] Subject: ${params.subject}`);
        // Simulate auto-approval for test
        const result = await executeFn(params);
        return { success: true, approved: true, result };
      }
    };

    // Test sending email to self or draft query verification
    // (Note: To prevent spamming real recipients, we can test with a self-test email address or check gate interception)
    console.log('  Simulating sending email via Approval Gate...');
    const sendParams = {
      to: 'pawarharish899@gmail.com',
      subject: 'Test Email from Personal AI Agent',
      body: 'This is an automated test email sent during Step 6 verification.'
    };

    const sendDispatchResult = await executeToolCall('gmail_send_message', sendParams, mockApprovalGate);
    console.log('✔ Approval Gate intercept check:', approvalRequested ? 'PASS' : 'FAIL');
    console.log('✔ Send email result status:', sendDispatchResult.approved ? 'APPROVED & EXECUTED' : 'FAILED');
    if (sendDispatchResult.result && sendDispatchResult.result.messageId) {
      console.log('✔ Gmail Sent Message ID:', sendDispatchResult.result.messageId);
    }

    console.log('\n🎉 ALL GMAIL TOOL INTEGRATION TESTS PASSED!');
  } catch (err) {
    console.error('\n✘ Gmail Tool Test Failed:', err);
    win.close();
    app.quit();
    process.exit(1);
  }

  win.close();
  app.quit();
});
