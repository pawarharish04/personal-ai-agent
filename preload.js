const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  sendMessage: (message) => ipcRenderer.invoke('chat:send-message', message),
  getHistory: () => ipcRenderer.invoke('chat:get-history'),
  getAuditLogs: () => ipcRenderer.invoke('chat:get-audit-logs'),
  getStorageHealth: () => ipcRenderer.invoke('storage:get-health'),
  onApprovalRequest: (callback) => {
    ipcRenderer.on('approval:request', (_event, data) => callback(data));
  },
  onStorageWarning: (callback) => {
    ipcRenderer.on('storage:over-hard-cap', (_event, data) => callback(data));
  },
  respondApproval: (response) => ipcRenderer.send('approval:response', response)
});
