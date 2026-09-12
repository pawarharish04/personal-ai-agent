# Personal AI Agent

A **local-first** desktop assistant powered by Claude. It browses the web, reads and sends email, and manages your Google Calendar — while keeping every piece of persistent data on your own machine. No backend, no cloud storage of your data, no analytics.

An LLM (Claude) acts as the "brain" that decides what to do; local Electron/Node.js code is the "hands" that actually does it. Every action with a real-world side effect is blocked behind an explicit approval dialog until you say yes.

---

## Why this exists

Most agent demos either run entirely in someone else's cloud, or are toy chatbots with no real tool access. This is an attempt at the middle ground: genuine agentic tool-calling — plan → act → observe, multiple real tools, a Claude API brain — with an explicit privacy boundary and a human approval gate in front of anything irreversible.

---

## What it does

| Capability | Tools | Requires Approval? |
|---|---|---|
| Chat with Claude | Native conversation | No |
| Web browsing | `browser_navigate`, `browser_read_page` | No |
| Web interaction | `browser_click`, `browser_fill_form` | ✅ Yes |
| Read email | `gmail_list_messages` | No |
| Send email | `gmail_send_message` | ✅ Yes |
| View calendar | `calendar_list_events` | No |
| Create event | `calendar_create_event` | ✅ Yes |

Every risky tool call is intercepted by the approval gate before it runs, and every decision — approved or declined, plus the outcome — is written to a local audit log.

---

## Privacy & security model

- **Local-only storage.** Chat history, tasks, and the audit log live in a SQLite database under Electron's OS-level `userData` folder — never on any server of ours.
- **Encrypted credentials.** Google OAuth tokens are encrypted at rest via Electron's `safeStorage` API, backed by your OS's real keychain (Keychain on macOS, DPAPI on Windows, libsecret on Linux) — never written to disk as plain JSON.
- **Cloud API used for reasoning only.** The Claude API receives only the minimal prompt text needed to decide the next step. It's a reasoning call, not a storage layer.
- **Approval gate on every side-effecting action.** Sending email, creating calendar events, and interactive browser actions are all blocked behind a real confirm/deny modal — the agent cannot act until you explicitly approve.
- **Untrusted web content.** Text scraped by the browser tool is always treated as data, never as instructions — a defense against prompt injection from malicious page content.

---

## Architecture

```
Claude API (cloud reasoning only)
      |
Electron app (desktop, local)
      |
      +-- Chat UI (renderer)
      +-- Agent orchestrator — plan / act / observe loop, max 8 tool-steps per turn
      +-- Local memory (SQLite: messages, tasks, audit_log)
      +-- Approval gate — blocks risky tool calls until you click approve/deny
      +-- Tools:
            - Browser (Playwright)
            - Gmail (OAuth2, safeStorage-encrypted tokens)
            - Google Calendar (same OAuth2 client)
```

---

## Tech stack

- **Shell:** Electron (Node.js + Chromium)
- **Brain:** Claude API (`@anthropic-ai/sdk`) with tool-calling
- **Hands:** Playwright (browser automation), Gmail API, Google Calendar API (via `googleapis`)
- **Memory:** SQLite (`better-sqlite3`), WAL mode
- **Auth:** Google OAuth2, desktop loopback consent flow, `safeStorage`-encrypted token persistence

---

## Prerequisites

- Node.js ≥ 18 (comes with npm)
- Git
- A Google Cloud Console account (free)
- An Anthropic API key ([console.anthropic.com](https://console.anthropic.com/))

---

## Setup

### 1. Clone and install

```bash
git clone https://github.com/pawarharish04/personal-ai-agent.git
cd personal-ai-agent
npm install
```

`npm install` automatically runs `electron-rebuild` via a `postinstall` hook, which compiles `better-sqlite3` against Electron's internal Node ABI. If you ever see a `NODE_MODULE_VERSION mismatch` error on `npm start`, run `npm run rebuild` to fix it.

### 2. Install the Playwright browser

```bash
npx playwright install chromium
```

One-time download (~200 MB) of the Chromium binary used for web automation.

### 3. Get an Anthropic API key

Create a key at [console.anthropic.com](https://console.anthropic.com/) (Settings → API Keys). New accounts get a small free credit grant — check the console's billing page for current terms.

### 4. Set up Google OAuth (for Gmail + Calendar)

1. Create a project at [console.cloud.google.com](https://console.cloud.google.com/)
2. **APIs & Services → Library** — enable the **Gmail API** and **Google Calendar API**
3. **APIs & Services → OAuth consent screen** (or the newer **Google Auth Platform**) — choose **External**, fill in app name and contact emails
4. Under **Data Access → Add or remove scopes**, use **Manually add scopes** to add:
   ```
   https://www.googleapis.com/auth/gmail.send
   https://www.googleapis.com/auth/gmail.readonly
   https://www.googleapis.com/auth/calendar
   ```
5. Under **Audience → Test users**, add your own Google account email — required while the app is in Testing mode
6. **APIs & Services → Credentials → Create Credentials → OAuth client ID** — Application type: **Desktop app**. Copy the Client ID and Client Secret it gives you.

> **Note:** as a Desktop app client, you don't need to pre-register the redirect URI with Google — it just needs to match what your code listens on locally.

### 5. Configure environment variables

```bash
cp .env.example .env
```

Fill in:
```
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-...
GOOGLE_REDIRECT_URI=http://localhost:8080/oauth2callback
```

**Never commit `.env`.** It's already excluded via `.gitignore`.

### 6. Run the one-time Google sign-in

```bash
npm run oauth:test
```

This opens your default browser to Google's real sign-in page. Since the app is in Testing mode and requests sensitive scopes, you'll see a **"Google hasn't verified this app"** warning — click **Advanced → Go to (app name)** to proceed. After approving, you'll land on a local "Authentication Successful!" page. The encrypted token is saved and reused on future runs — you won't need to repeat this unless you delete the token or revoke access.

### 7. Start the app

```bash
npm start
```

Try asking it things like:
- *"What's on the front page of news.ycombinator.com?"* (browser tool)
- *"Do I have any unread emails from GitHub?"* (Gmail, read-only)
- *"Send a quick hello to [email protected]"* (Gmail send — triggers approval)
- *"What do I have scheduled this week?"* (Calendar, read-only)
- *"Block off 2–3pm tomorrow for a team sync"* (Calendar create — triggers approval)

---

## Available npm scripts

| Script | Description |
|---|---|
| `npm start` | Start the Electron app |
| `npm run oauth:test` | Run the real Google OAuth consent flow |
| `npm run gmail:test` | Test Gmail list + send (needs a valid token) |
| `npm run calendar:test` | Test Calendar list + create (needs a valid token) |
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
│   ├── orchestrator.js            — Plan/act/observe loop (max 8 tool steps per turn)
│   ├── tools/
│   │   ├── index.js               — Tool registry + dispatcher (approval routing)
│   │   ├── browser.js             — Playwright: navigate, read_page, click, fill_form
│   │   ├── gmail.js                — Gmail: list messages, send message
│   │   ├── calendar.js            — Calendar: list events, create event
│   │   ├── gmail-test.js
│   │   ├── calendar-test.js
│   │   └── auth/
│   │       ├── google-auth.js     — OAuth2 client, safeStorage encryption, loopback flow
│   │       └── oauth-test.js
│   ├── approval/
│   │   └── gate.js                — Approval dialog + audit logging
│   └── memory/
│       └── db.js                  — SQLite schema (messages, tasks, audit_log)
└── renderer/
    ├── index.html                 — Chat window + approval modal
    ├── styles.css
    └── app.js
```

---

## Troubleshooting

**`NODE_MODULE_VERSION mismatch` on `npm start`**
Native modules were compiled for the wrong Node version. Run `npm run rebuild`.

**`redirect_uri_mismatch` OAuth error**
Your `GOOGLE_REDIRECT_URI` doesn't match what's expected — check for `https` vs `http`, `127.0.0.1` vs `localhost`, or a different port.

**`access_denied` / "app has not completed verification"**
Your Google account isn't listed as a test user. Go to Google Cloud Console → Audience (or OAuth consent screen) → Test users → add your email, then retry.

**Port 8080 already in use**
Something else on your machine is bound to that port. Check with `netstat -ano | findstr :8080` (Windows) or `lsof -i :8080` (macOS/Linux), then either free the port or change `GOOGLE_REDIRECT_URI` in `.env` to a different one.

**Claude API errors**
Confirm `ANTHROPIC_API_KEY` in `.env` is a valid, current key from [console.anthropic.com](https://console.anthropic.com/).

---

## Known issues / things to verify

This project was built incrementally with an AI coding agent, step by step, with manual verification at each step. A few things are worth double-checking against the current code rather than assuming they're settled:

- **Model version** — confirm `orchestrator.js` uses a current Claude model string, not an old dated snapshot.
- **Audit log completeness** — confirm the `outcome` column in `audit_log` is actually populated after a tool runs (success/error), not just the approval decision.
- **Calendar timezones** — `calendar_create_event` should send an explicit `timeZone` alongside `dateTime`; without it, events can land at the wrong local time.
- **`.gitignore` coverage** — currently excludes `*.db`, `*.db-journal`, `*.db-wal`, and `tokens.json`, but not `*.db-shm` (WAL mode creates this file too). Low risk in practice since the database and token files live under Electron's `userData` folder outside the repo, but worth tightening for correctness, and worth confirming the actual encrypted token filename matches what's excluded.

---

## Disclaimer

This is a personal project built to learn agentic tool-use patterns end to end — not a production or multi-user system. It assumes a single trusted user running it on their own machine, with Google API access limited to that user's own account in OAuth "Testing" mode.

