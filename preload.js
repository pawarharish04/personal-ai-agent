const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  sendMessage: (message) => ipcRenderer.invoke('chat:send-message', message),
  getHistory: () => ipcRenderer.invoke('chat:get-history'),
  onApprovalRequest: (callback) => ipcRenderer.on('approval:request', (_event, data) => callback(data)),
  respondApproval: (response) => ipcRenderer.send('approval:response', response)
});
