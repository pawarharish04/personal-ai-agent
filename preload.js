const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  sendMessage: (message) => ipcRenderer.invoke('chat:send-message', message),
  getHistory: () => ipcRenderer.invoke('chat:get-history'),
  clearHistory: () => ipcRenderer.invoke('chat:clear-history'),
  getSessions: () => ipcRenderer.invoke('chat:get-sessions'),
  loadSession: (sessionId) => ipcRenderer.invoke('chat:load-session', sessionId),
  getAuditLogs: () => ipcRenderer.invoke('chat:get-audit-logs'),
  getStorageHealth: () => ipcRenderer.invoke('storage:get-health'),
  onApprovalRequest: (callback) => {
    ipcRenderer.on('approval:request', (_event, data) => callback(data));
  },
  onStorageWarning: (callback) => {
    ipcRenderer.on('storage:over-hard-cap', (_event, data) => callback(data));
  },
  onPttStart: (callback) => {
    ipcRenderer.on('ptt:start', () => callback());
  },
  onPttStop: (callback) => {
    ipcRenderer.on('ptt:stop', () => callback());
  },
  respondApproval: (response) => ipcRenderer.send('approval:response', response)
});
