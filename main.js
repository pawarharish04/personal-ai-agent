const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
require('dotenv').config();
const { Orchestrator } = require('./src/orchestrator');
const { ApprovalGate } = require('./src/approval/gate');

let mainWindow;
let orchestrator;
let approvalGate;

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
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
