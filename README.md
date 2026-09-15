# Personal AI Agent

A local-first desktop assistant powered by Groq (Llama 3). It can browse the web, read and send email, and manage your Google Calendar — while keeping persistent data encrypted on your own device.

---

## Features

| Capability | Tools | Requires Approval? |
|---|---|---|
| **Chat with Llama 3** | Native conversation | No |
| **Web browsing** | `browser_navigate`, `browser_read_page` | No |
| **Web interaction** | `browser_click`, `browser_fill_form` | Yes |
| **Read email** | `gmail_list_messages` | No |
| **Send email** | `gmail_send_message` | Yes |
| **View calendar** | `calendar_list_events` | No |
| **Create event** | `calendar_create_event` | Yes |

Any action with a side effect is blocked behind a user-approval dialog before it runs. Every decision is written to a local audit log.

---

## Privacy guarantees

- All persistent data — chat history, memory, and audit logs — is stored in **SQLite on your local device only**.
- OAuth tokens are **encrypted at rest** using Electron's `safeStorage` API (OS keychain) and are never written as plain JSON to disk.
- The Groq API receives only the minimum prompt text needed to reason. It is used for thinking, not long-term storage.
- Playwright-scraped page content is treated as **untrusted data** and is clearly framed before being passed to Llama 3 to help prevent prompt injection.

---

## Prerequisites

- Node.js 18 or newer (includes npm)
- Git
- A Google Cloud Console account (free)
- A Groq API key (get one at https://console.groq.com/)

---

## Quick start

```bash
git clone https://github.com/pawarharish04/personal-ai-agent.git
cd personal-ai-agent
npm install
npx playwright install chromium
cp .env.example .env
npm run oauth:test
npm start
```

---

## Installation details

1) Install dependencies

```bash
npm install
```

`npm install` automatically runs `electron-rebuild` as a `postinstall` hook to compile native modules like `better-sqlite3` against Electron's internal Node ABI. If you see a `NODE_MODULE_VERSION` mismatch error, run:

```bash
npm run rebuild
```

2) Install Playwright browser

```bash
npx playwright install chromium
```

Only required once. Playwright provides the Chromium instance used for web automation.

3) Configure environment variables

Copy the example file and fill in your keys:

```bash
cp .env.example .env
```

Edit `.env` and set the following (example values):

```env
# Groq API Key
GROQ_API_KEY=gsk_...

# Google OAuth (Desktop Application client)
GOOGLE_CLIENT_ID=your_client_id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-...
GOOGLE_REDIRECT_URI=http://localhost:8080/oauth2callback
```

> CAUTION: `.env` is listed in `.gitignore`. Never commit it or share it.

4) Set up Google OAuth credentials

You need a Google Cloud OAuth 2.0 "Desktop app" client. High-level steps:

- Create a Google Cloud project.
- Enable the Gmail API and Google Calendar API.
- Create an OAuth consent screen (External, add your email as a test user).
- Create OAuth credentials: choose "Desktop app" and add the redirect URI:

```
http://localhost:8080/oauth2callback
```

This value must match exactly (http, port 8080, localhost).

Run the one-time sign-in to obtain and persist tokens:

```bash
npm run oauth:test
```

This will open a browser, run the consent flow, and save encrypted tokens locally.

---

## Start the app

```bash
npm start
```

The Electron window opens. Type any message to start chatting. Example prompts:

- "What's on the front page of news.ycombinator.com?"
- "Do I have any unread emails from GitHub?"
- "Send a quick hello to alice@example.com" (approval required)
- "What do I have scheduled this week?"

---

## Available npm scripts

| Script | Description |
|---|---|
| `npm start` | Start the Electron app |
| `npm run oauth:test` | Run the Google OAuth consent flow |
| `npm run gmail:test` | Test Gmail list + send (requires valid tokens) |
| `npm run calendar:test` | Test Calendar list + create (requires valid tokens) |
| `npm run rebuild` | Recompile native modules against Electron's Node ABI |

---

## Project structure

```text
personal-ai-agent/
├── main.js                        — Electron entry, IPC, approval dialog wiring
├── preload.js                     — Secure contextBridge for renderer ↔ main
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
│   │       └── oauth-test.js      — Interactive OAuth consent flow test
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

- `NODE_MODULE_VERSION mismatch` on `npm start`
  - Run: `npm run rebuild`

- `redirect_uri_mismatch` OAuth error
  - Ensure your OAuth redirect URI in Google Cloud exactly matches `http://localhost:8080/oauth2callback` (no https, no 127.0.0.1, same port).

- `This app is blocked` OAuth error
  - Add your Google account as a test user in the OAuth consent screen in Google Cloud Console.

- Port 8080 already in use during OAuth
  - Identify the process using port 8080 and stop it, or change `GOOGLE_REDIRECT_URI` in `.env` and update the redirect URI in Google Cloud Console accordingly.

- Groq API errors
  - Verify `GROQ_API_KEY` in `.env` is set to a valid key from https://console.groq.com/.

---

## Contributing

Contributions are welcome. If you plan to make changes:

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-change`
3. Make changes and run `npm install` / `npm run rebuild` if needed
4. Open a pull request with a clear description of your changes

If you want help prioritizing features or filing issues, open an issue describing the request.

---

## License

No license is specified in this repository. If you want to add a license, create a `LICENSE` file at the project root.
