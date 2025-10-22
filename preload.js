const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    getClipboard: () => ipcRenderer.invoke('get-clipboard'),
    setClipboard: (text) => ipcRenderer.invoke('set-clipboard', text),
    hideWindow: () => ipcRenderer.invoke('hide-window'),
    getSettings: () => ipcRenderer.invoke('get-settings'),
    saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
    getActiveWindow: () => ipcRenderer.invoke('get-active-window'),
    onQuickActionMode: (callback) => ipcRenderer.on('quick-action-mode', callback)
});
