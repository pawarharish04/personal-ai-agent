const { google } = require('googleapis');
const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');
const { app, shell, safeStorage } = require('electron');
const crypto = require('crypto');
require('dotenv').config();

function getDefaultTokensPath() {
  try {
    if (app && typeof app.getPath === 'function') {
      return path.join(app.getPath('userData'), 'tokens.enc');
    }
  } catch (e) {}
  
  // Hardened fallback: never write inside the repository folder.
  const os = require('os');
  return path.join(os.homedir(), '.personal-agent-tokens.enc');
}

class GoogleAuthManager {
  constructor(tokensFilePath) {
    this.clientId = process.env.GOOGLE_CLIENT_ID;
    this.clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    this.redirectUri = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:8080/oauth2callback';
    
    this.tokensFilePath = tokensFilePath || getDefaultTokensPath();

    this.scopes = [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/calendar'
    ];

    this.oauth2Client = new google.auth.OAuth2(
      this.clientId,
      this.clientSecret,
      this.redirectUri
    );

    // Auto-save refreshed tokens
    this.oauth2Client.on('tokens', (tokens) => {
      this.saveTokens(tokens);
    });
  }

  /**
   * Save tokens encrypted at rest using Electron safeStorage (or secure fallback)
   */
  saveTokens(tokens) {
    try {
      let existingTokens = {};
      if (fs.existsSync(this.tokensFilePath)) {
        existingTokens = this.loadTokens() || {};
      }
      
      const mergedTokens = { ...existingTokens, ...tokens };
      const jsonStr = JSON.stringify(mergedTokens);

      if (safeStorage && safeStorage.isEncryptionAvailable()) {
        const encryptedBuffer = safeStorage.encryptString(jsonStr);
        fs.writeFileSync(this.tokensFilePath, encryptedBuffer);
      } else {
        // Fallback AES-256-GCM encryption for non-keychain environments
        const fallbackKey = crypto.createHash('sha256').update(this.clientId || 'agent-secret').digest();
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv('aes-256-gcm', fallbackKey, iv);
        let encrypted = cipher.update(jsonStr, 'utf8');
        encrypted = Buffer.concat([encrypted, cipher.final()]);
        const authTag = cipher.getAuthTag();
        const payload = Buffer.concat([iv, authTag, encrypted]);
        fs.writeFileSync(this.tokensFilePath, payload);
      }
      return true;
    } catch (err) {
      console.error('Failed to encrypt and save OAuth tokens:', err);
      return false;
    }
  }

  /**
   * Read and decrypt tokens from local storage
   */
  loadTokens() {
    try {
      if (!fs.existsSync(this.tokensFilePath)) {
        return null;
      }
      const buffer = fs.readFileSync(this.tokensFilePath);

      if (safeStorage && safeStorage.isEncryptionAvailable()) {
        const decryptedStr = safeStorage.decryptString(buffer);
        return JSON.parse(decryptedStr);
      } else {
        // Fallback AES-256-GCM decryption
        const fallbackKey = crypto.createHash('sha256').update(this.clientId || 'agent-secret').digest();
        const iv = buffer.subarray(0, 12);
        const authTag = buffer.subarray(12, 28);
        const encryptedText = buffer.subarray(28);
        const decipher = crypto.createDecipheriv('aes-256-gcm', fallbackKey, iv);
        decipher.setAuthTag(authTag);
        let decrypted = decipher.update(encryptedText, 'utf8');
        decrypted += decipher.final('utf8');
        return JSON.parse(decrypted);
      }
    } catch (err) {
      console.error('Failed to load/decrypt OAuth tokens:', err);
      return null;
    }
  }

  /**
   * Perform Desktop Loopback Consent Flow on port 8080
   */
  async startConsentFlow() {
    return new Promise((resolve, reject) => {
      const authUrl = this.oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: this.scopes,
        prompt: 'consent'
      });

      // Parse port from redirectUri
      const parsedUrl = new URL(this.redirectUri);
      const port = parseInt(parsedUrl.port || '8080', 10);
      const pathname = parsedUrl.pathname || '/oauth2callback';

      const server = http.createServer(async (req, res) => {
        try {
          const reqUrl = url.parse(req.url, true);
          if (reqUrl.pathname === pathname) {
            const code = reqUrl.query.code;

            if (code) {
              res.writeHead(200, { 'Content-Type': 'text/html' });
              res.end(`
                <!DOCTYPE html>
                <html>
                <head><title>Authentication Successful</title></head>
                <body style="font-family: sans-serif; text-align: center; padding-top: 50px; background-color: #0f172a; color: #f8fafc;">
                  <h1 style="color: #10b981;">Authentication Successful!</h1>
                  <p>Google OAuth authorization complete. You can close this browser tab and return to the Personal AI Agent.</p>
                </body>
                </html>
              `);

              server.close();

              // Exchange code for tokens
              const { tokens } = await this.oauth2Client.getToken(code);
              this.oauth2Client.setCredentials(tokens);
              this.saveTokens(tokens);

              resolve(this.oauth2Client);
            } else if (reqUrl.query.error) {
              res.writeHead(400, { 'Content-Type': 'text/html' });
              res.end(`<h1>Authentication Failed</h1><p>${reqUrl.query.error}</p>`);
              server.close();
              reject(new Error(`OAuth Error: ${reqUrl.query.error}`));
            }
          }
        } catch (err) {
          server.close();
          reject(err);
        }
      });

      server.listen(port, () => {
        // Open default OS browser to consent URL
        if (shell && typeof shell.openExternal === 'function') {
          shell.openExternal(authUrl);
        } else {
          require('child_process').exec(`start "" "${authUrl}"`);
        }
      });

      server.on('error', (err) => {
        reject(new Error(`Loopback server error on port ${port}: ${err.message}`));
      });
    });
  }

  /**
   * Get authenticated OAuth2 client, auto-refreshing if needed
   */
  async getAuthenticatedClient() {
    const tokens = this.loadTokens();
    if (tokens && (tokens.access_token || tokens.refresh_token)) {
      this.oauth2Client.setCredentials(tokens);
      return this.oauth2Client;
    }

    // Trigger consent flow if no tokens saved
    return await this.startConsentFlow();
  }

  isAuthorized() {
    const tokens = this.loadTokens();
    return !!(tokens && (tokens.access_token || tokens.refresh_token));
  }
}

module.exports = { GoogleAuthManager };
