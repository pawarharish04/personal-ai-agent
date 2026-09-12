# Personal AI Agent

A **local-first** desktop assistant powered by Claude AI. Browses the web, reads and sends email, and manages your Google Calendar — all while keeping every piece of data encrypted on your own machine. No backend, no cloud storage, no analytics.

---

## What it does

| Capability | Tools | Requires Approval? |
|---|---|---|
| **Chat with Claude** | Native conversation | No |
| **Web browsing** | `browser_navigate`, `browser_read_page` | No |
| **Web interaction** | `browser_click`, `browser_fill_form` | ✅ Yes |
| **Read email** | `gmail_list_messages` | No |
| **Send email** | `gmail_send_message` | ✅ Yes |
| **View calendar** | `calendar_list_events` | No |
| **Create event** | `calendar_create_event` | ✅ Yes |

Every action with a side-effect is blocked behind a user-approval dialog before it runs. Every decision is written to a local audit log.

---

## Privacy guarantees

- All persistent data — chat history, memory, audit log — is stored in **SQLite on your local device only**.
- OAuth tokens are **encrypted at rest** using Electron's `safeStorage` API (OS Keychain). Never written as plain JSON to disk.
- The Claude API receives only the minimum prompt text needed to reason. It is used for thinking, not storage.
- Playwright-scraped page content is always treated as **untrusted data** and clearly framed before being passed to Claude, preventing prompt injection.

---

## Prerequisites

- **Node.js** ≥ 18 (comes with npm)
- **Git**
- A **Google Cloud Console** account (free)
- An **Anthropic API key** ([get one here](https://console.anthropic.com/))

---

## 1. Clone and install

```bash
git clone https://github.com/pawarharish04/personal-ai-agent.git
cd personal-ai-agent
npm install
```

`npm install` automatically runs `electron-rebuild` as a `postinstall` hook. This compiles `better-sqlite3` against Electron's internal Node ABI. If you see a `NODE_MODULE_VERSION mismatch` error on `npm start`, run:

```bash
npm run rebuild
```

---

## 2. Install the Playwright browser

```bash
npx playwright install chromium
```

This downloads the Chromium browser used for web automation (~200 MB). Only needed once.

---

## 3. Configure environment variables

Copy the example file and fill in your keys:

```bash
cp .env.example .env
```

Edit `.env`:

```env
# Anthropic Claude API Key
ANTHROPIC_API_KEY=sk-ant-...

# Google OAuth (Desktop Application client)
GOOGLE_CLIENT_ID=your_client_id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-...
GOOGLE_REDIRECT_URI=http://localhost:8080/oauth2callback
```

> [!CAUTION]
> `.env` is listed in `.gitignore`. Never commit it. Never share it.

---

## 4. Set up Google OAuth credentials

You need a **Google Cloud OAuth 2.0 Desktop Application** client. This is a one-time setup.

### 4a. Create a Google Cloud project

1. Go to [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project (e.g. `personal-ai-agent`).
3. Navigate to **APIs & Services → Library**.
4. Enable these two APIs:
   - **Gmail API**
   - **Google Calendar API**

### 4b. Create the OAuth consent screen

1. Go to **APIs & Services → OAuth consent screen**.
2. Choose **External** user type → click **Create**.
3. Fill in App name, user support email, and developer email.
4. On the **Scopes** page, add:
   - `https://www.googleapis.com/auth/gmail.readonly`
   - `https://www.googleapis.com/auth/gmail.send`
   - `https://www.googleapis.com/auth/calendar`
5. On the **Test users** page, **add your own Gmail address**. (Required while the app is in Testing mode.)
6. Save and continue.

### 4c. Create the OAuth Client ID

1. Go to **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
2. Application type: **Desktop app**.
3. Name it anything (e.g. `personal-ai-agent-desktop`).
4. Under **Authorized redirect URIs**, add exactly:
   ```
   http://localhost:8080/oauth2callback
   ```
   > [!IMPORTANT]
   > This URI must be **exactly** `http://localhost:8080/oauth2callback` — not `https://`, not `127.0.0.1`, not a different port. Google treats these as distinct.
5. Click **Create**. Copy the **Client ID** and **Client Secret** into your `.env`.

### 4d. Run the one-time Google sign-in

```bash
npm run oauth:test
```

This will:
1. Open your default browser to Google's sign-in page.
2. Show a **"Google hasn't verified this app"** warning — this is expected for Testing mode. Click **Advanced → Go to [app name] (unsafe)**.
3. Approve Gmail and Calendar permissions.
4. Redirect back to `localhost:8080` — you'll see "Authentication Successful!".
5. Confirm token persistence: the app immediately simulates a restart and confirms it loads the token without reopening the browser.

After this, tokens are saved encrypted on disk. You won't need to do this again unless you delete the tokens file or revoke access.

---

## 5. Start the app

```bash
npm start
```

The Electron window opens. Type any message to start chatting. Ask it to:
- Browse a website: *"What's on the front page of news.ycombinator.com?"*
- Check email: *"Do I have any unread emails from GitHub?"*
- Send email: *"Send a quick hello to alice@example.com"* (will trigger approval dialog)
- View calendar: *"What do I have scheduled this week?"*
- Create an event: *"Block off 2pm–3pm tomorrow for a team sync"* (will trigger approval dialog)

---

## Available npm scripts

| Script | Description |
|---|---|
| `npm start` | Start the Electron app |
| `npm run oauth:test` | Run the real Google OAuth consent flow |
| `npm run gmail:test` | Test Gmail list + send (needs valid tokens) |
| `npm run calendar:test` | Test Calendar list + create (needs valid tokens) |
| `npm run rebuild` | Recompile native modules against Electron's Node ABI |

---

## Project structure

```
personal-ai-agent/
├── main.js                        — Electron entry, IPC, approval dialog wiring
├── preload.js                     — Secure contextBridge for renderer <-> main
├── package.json
├── .env.example                   — Copy to .env and fill in your keys
├── PROGRESS.md                    — Build step tracker
├── src/
│   ├── orchestrator.js            — Plan/Act/Observe loop (max 8 tool steps per turn)
│   ├── tools/
│   │   ├── index.js               — Central tool registry + dispatcher (approval routing)
│   │   ├── browser.js             — Playwright: navigate, read_page, click, fill_form
│   │   ├── gmail.js               — Gmail: list messages, send message
│   │   ├── calendar.js            — Calendar: list events, create event
│   │   ├── gmail-test.js          — Interactive Gmail end-to-end test
│   │   ├── calendar-test.js       — Interactive Calendar end-to-end test
│   │   └── auth/
│   │       ├── google-auth.js     — OAuth2 client, safeStorage encryption, loopback flow
│   │       └── oauth-test.js      — Real interactive OAuth consent flow test
│   ├── approval/
│   │   └── gate.js                — Approval dialog + audit logging
│   └── memory/
│       └── db.js                  — SQLite schema (messages, tasks, audit_log)
└── renderer/
    ├── index.html                 — Chat window + approval modal
    ├── styles.css                 — Dark-mode UI styling
    └── app.js                     — Renderer logic (chat, approval modal handling)
```

---

## Troubleshooting

### `NODE_MODULE_VERSION mismatch` on `npm start`
Native modules (better-sqlite3) were compiled for the wrong Node version. Fix:
```bash
npm run rebuild
```

### `redirect_uri_mismatch` OAuth error
The redirect URI in your Google Cloud Console OAuth client does not exactly match `http://localhost:8080/oauth2callback`. Check for `https`, `127.0.0.1`, or port differences.

### `This app is blocked` OAuth error
Your Google account isn't listed as a Test User. Go to Google Cloud Console → OAuth consent screen → Test users → Add your email.

### Port 8080 already in use during OAuth
Another process is binding port 8080. Run `netstat -ano | findstr :8080` to identify it. Either stop it or change `GOOGLE_REDIRECT_URI` in `.env` and update the redirect URI in Google Cloud Console to match the new port.

### Claude API errors
Verify `ANTHROPIC_API_KEY` in `.env` is set to a valid key from [console.anthropic.com](https://console.anthropic.com/).
