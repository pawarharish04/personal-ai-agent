const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  sendMessage: (message) => ipcRenderer.invoke('chat:send-message', message),
  getHistory: () => ipcRenderer.invoke('chat:get-history'),
  getAuditLogs: () => ipcRenderer.invoke('chat:get-audit-logs'),
  onApprovalRequest: (callback) => {
    ipcRenderer.on('approval:request', (_event, data) => callback(data));
  },
  respondApproval: (response) => ipcRenderer.send('approval:response', response)
});
