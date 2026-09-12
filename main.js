const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
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

app.whenReady().then(() => {
  const dbPath = path.join(app.getPath('userData'), 'agent_memory.db');
  
  // 1. Initialize Orchestrator
  orchestrator = new Orchestrator(dbPath);

  // 2. Initialize Approval Gate linked to Orchestrator DB and Window
  approvalGate = new ApprovalGate(orchestrator.db, () => mainWindow);
  orchestrator.setApprovalGate(approvalGate);

  // IPC Handlers
  ipcMain.handle('chat:send-message', async (_event, message) => {
    return await orchestrator.handleUserMessage(message);
  });

  ipcMain.handle('chat:get-history', async () => {
    return orchestrator.getHistory();
  });

  ipcMain.handle('chat:get-audit-logs', async () => {
    return orchestrator.getAuditLogs();
  });

  // Listener for user response from approval modal
  ipcMain.on('approval:response', (_event, { id, approved }) => {
    if (approvalGate) {
      approvalGate.handleUserResponse(id, approved);
    }
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
