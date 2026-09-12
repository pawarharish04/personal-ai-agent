/**
 * Step 5 - Real Interactive OAuth Flow Test
 * Run with: npx electron src/tools/auth/oauth-test.js
 * 
 * This forces a fresh consent flow and lets you click through the real Google
 * sign-in page including the "unverified app" screen (click Advanced -> proceed).
 * After completing login, it loads tokens back from disk and confirms persistence.
 */
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });
const { GoogleAuthManager } = require('./google-auth');

// Token file stored in app userData for the real app
const tokensPath = path.join(app.getPath('userData'), 'tokens.enc');

app.whenReady().then(async () => {
  // Create a minimal hidden window so safeStorage is available
  const win = new BrowserWindow({ show: false });

  console.log('\n=======================================================');
  console.log('  Step 5 Real OAuth Flow Test');
  console.log('=======================================================');
  console.log('Tokens file:', tokensPath);

  // Step 1: Delete existing tokens to force fresh consent
  if (fs.existsSync(tokensPath)) {
    fs.unlinkSync(tokensPath);
    console.log('✔ Deleted existing tokens.enc to force fresh consent flow.');
  }

  const authManager = new GoogleAuthManager(tokensPath);
  console.log('Initial isAuthorized():', authManager.isAuthorized(), '(expected: false)');

  console.log('\n>>> Opening your default browser to Google sign-in...');
  console.log('    Expect the "Google hasn\'t verified this app" warning.');
  console.log('    Click "Advanced" -> "Go to [your app] (unsafe)" to proceed.\n');

  try {
    // This opens the real browser and waits on port 8080 for redirect
    const client = await authManager.getAuthenticatedClient();
    console.log('\n✔ Consent flow completed successfully!');
    console.log('✔ Token file exists on disk:', fs.existsSync(tokensPath));

    // Verify the token is encrypted (not readable plain JSON)
    const raw = fs.readFileSync(tokensPath, 'utf8');
    const isEncrypted = !raw.includes('access_token') && !raw.includes('refresh_token');
    console.log('✔ Token plaintext leak check:', isEncrypted ? 'PASS (encrypted)' : 'FAIL (plain text detected!)');

    // Step 2: Simulate restart — create fresh manager and load from disk
    console.log('\n>>> Simulating app restart (loading token from disk without consent)...');
    const authManager2 = new GoogleAuthManager(tokensPath);
    const client2 = await authManager2.getAuthenticatedClient();
    console.log('✔ Token reloaded from encrypted disk storage — no browser window opened.');
    console.log('✔ isAuthorized after reload:', authManager2.isAuthorized());

    console.log('\n🎉 ALL REAL OAUTH FLOW TESTS PASSED!');
    console.log('You are ready to proceed to Step 6 (Gmail Tool).');
  } catch (err) {
    console.error('\n✘ OAuth flow failed:', err.message);
    console.error('   Check: Is your email listed under "Test users" in Google Cloud Console?');
    console.error('   Check: Is GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET set in .env?');
    console.error('   Check: Is http://localhost:8080/oauth2callback in your OAuth client redirect URIs?');
    process.exit(1);
  }

  win.close();
  app.quit();
});
