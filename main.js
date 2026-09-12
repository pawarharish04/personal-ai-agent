const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
require('dotenv').config();
const { Orchestrator } = require('./src/orchestrator');
const { ApprovalGate } = require('./src/approval/gate');
const { uIOhook, UiohookKey } = require('uiohook-napi');

let mainWindow;
let overlayWindow;
let orchestrator;
let approvalGate;
let isPttActive = false;
let globalKeyConfig = { pttKey: UiohookKey.AltRight }; // Could be loaded from DB later

function createOverlayWindow() {
  const { screen } = require('electron');
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;
  const overlayWidth = 150;
  const overlayHeight = 150;

  overlayWindow = new BrowserWindow({
    width: overlayWidth,
    height: overlayHeight,
    x: width - overlayWidth - 20,
    y: height - overlayHeight - 20,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  
  overlayWindow.loadFile(path.join(__dirname, 'renderer', 'overlay.html'));
  
  // Pass clicks through so it doesn't block other apps when active
  overlayWindow.setIgnoreMouseEvents(true);

  overlayWindow.on('closed', () => {
    overlayWindow = null;
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 980,
    height: 720,
    minWidth: 800,
    minHeight: 600,
    title: 'Personal AI Agent',
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  createOverlayWindow();
}

function setupGlobalKeyListener() {
  uIOhook.on('keydown', (e) => {
    if (e.keycode === globalKeyConfig.pttKey) {
      if (!isPttActive) {
        isPttActive = true;
        // Broadcast ptt:start
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('ptt:start');
          // Show overlay if main window is not focused
          if (!mainWindow.isFocused() && overlayWindow && !overlayWindow.isDestroyed()) {
            overlayWindow.showInactive();
          }
        }
      }
    }
  });

  uIOhook.on('keyup', (e) => {
    if (e.keycode === globalKeyConfig.pttKey) {
      if (isPttActive) {
        isPttActive = false;
        // Broadcast ptt:stop
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('ptt:stop');
        }
        if (overlayWindow && !overlayWindow.isDestroyed()) {
          overlayWindow.hide();
        }
      }
    }
  });

  uIOhook.start();
}

app.whenReady().then(async () => {
  const dbPath = path.join(app.getPath('userData'), 'agent_memory.db');

  // 1. Initialize Orchestrator (creates DB, MemoryManager, session ID)
  orchestrator = new Orchestrator(dbPath);

  // 2. Initialize Approval Gate linked to Orchestrator DB and Window
  approvalGate = new ApprovalGate(orchestrator.db, () => mainWindow);
  orchestrator.setApprovalGate(approvalGate);

  // 3. Run maintenance in the background (non-blocking startup)
  const executeMaintenance = async () => {
    try {
      const result = await orchestrator.runMaintenance();
      if (result) {
        console.log(`[MemoryManager] Maintenance complete. Reclaimed: ${Math.round(result.reclaimedBytes / 1024)} KB`);
        if (result.overHardCap && mainWindow) {
          mainWindow.webContents.send('storage:over-hard-cap', orchestrator.getStorageHealth());
        }
      }
    } catch (err) {
      console.error('[MemoryManager] Maintenance error:', err);
    }
  };

  executeMaintenance();

  // 4. Recurring daily maintenance interval (24 hours)
  const MAINTENANCE_INTERVAL_MS = 24 * 60 * 60 * 1000;
  setInterval(() => {
    console.log('[MemoryManager] Running scheduled daily maintenance...');
    executeMaintenance();
  }, MAINTENANCE_INTERVAL_MS);

  // ── IPC Handlers ────────────────────────────────────────────────────

  ipcMain.handle('chat:send-message', async (_event, message) => {
    return await orchestrator.handleUserMessage(message);
  });

  ipcMain.handle('chat:get-history', async () => {
    return orchestrator.getHistory();
  });

  ipcMain.handle('chat:clear-history', async () => {
    orchestrator.clearHistory();
    return { success: true };
  });

  ipcMain.handle('chat:get-sessions', async () => {
    return orchestrator.getSessions();
  });

  ipcMain.handle('chat:load-session', async (_event, sessionId) => {
    return orchestrator.loadSession(sessionId);
  });

  ipcMain.handle('chat:get-audit-logs', async () => {
    return orchestrator.getAuditLogs();
  });

  ipcMain.handle('storage:get-health', async () => {
    return orchestrator.getStorageHealth();
  });

  // Approval modal response from renderer
  ipcMain.on('approval:response', (_event, { id, approved }) => {
    if (approvalGate) approvalGate.handleUserResponse(id, approved);
  });

  createWindow();

  // After window is ready, send initial storage health to renderer
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
  
  setupGlobalKeyListener();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
