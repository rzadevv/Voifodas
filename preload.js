const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    getClipboard: () => ipcRenderer.invoke('get-clipboard'),
    setClipboard: (text) => ipcRenderer.invoke('set-clipboard', text),
    hideWindow: () => ipcRenderer.invoke('hide-window'),
    getSettings: () => ipcRenderer.invoke('get-settings'),
    saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
    getActiveWindow: () => ipcRenderer.invoke('get-active-window'),
    captureScreen: () => ipcRenderer.invoke('capture-screen'),
    onQuickActionMode: (callback) => ipcRenderer.on('quick-action-mode', callback),
    onCaptureScreenMode: (callback) => ipcRenderer.on('capture-screen-mode', callback),
    onListeningModeToggle: (callback) => ipcRenderer.on('listening-mode-toggle', callback)
});
