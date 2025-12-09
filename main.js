const { app, BrowserWindow, globalShortcut, ipcMain, screen, clipboard } = require('electron');
const path = require('path');
const Store = require('electron-store');

const store = new Store();
let mainWindow = null;
let isVisible = false;

function createWindow() {
    const { width, height } = screen.getPrimaryDisplay().workAreaSize;

    mainWindow = new BrowserWindow({
        width: 450,
        height: 700,
        minWidth: 400,
        minHeight: 500,
        x: width - 520,
        y: 20,
        transparent: true,
        frame: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: true,
        show: false,
        hasShadow: false,
        backgroundColor: '#00000000',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            backgroundThrottling: false,
            offscreen: false
        }
    });

    mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

    // fix white borders
    mainWindow.webContents.on('did-finish-load', () => {
        mainWindow.webContents.insertCSS(`
            body {
                margin: 0 !important;
                padding: 0 !important;
                overflow: hidden !important;
                background: transparent !important;
            }
        `);
    });

    // mac specific
    if (process.platform === 'darwin') {
        mainWindow.setWindowLevel('screen-saver');
        try {
            mainWindow.setContentProtection(true);
        } catch (e) {
            console.log('Content protection not available');
        }
    }

    // windows specific - hide from screen recordings
    if (process.platform === 'win32') {
        mainWindow.setSkipTaskbar(true);
        try {
            mainWindow.setContentProtection(true);
        } catch (e) {
            console.log('Content protection not available');
        }

        mainWindow.once('ready-to-show', () => {
            if (mainWindow.setContentProtection) {
                mainWindow.setContentProtection(true);
            }
        });
    }

    // hide when clicking away
    mainWindow.on('blur', () => {
        const settings = store.get('settings', {});
        if (settings.hideOnBlur !== false) {
            mainWindow.hide();
        }
    });

    mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
        console.error('Failed to load:', errorCode, errorDescription);
    });

    mainWindow.webContents.on('crashed', () => {
        console.error('Window crashed');
    });
}

function showWindow() {
    if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
        isVisible = true;
    }
}

function hideWindow() {
    if (mainWindow) {
        mainWindow.hide();
        isVisible = false;
    }
}

function toggleWindow() {
    if (isVisible) {
        hideWindow();
    } else {
        showWindow();
    }
}

app.whenReady().then(() => {
    createWindow();

    // ctrl+space to toggle
    const ret = globalShortcut.register('CommandOrControl+Space', () => {
        toggleWindow();
    });

    if (!ret) {
        console.log('Global shortcut registration failed');
    }

    // alt+a as backup
    globalShortcut.register('Alt+A', () => {
        toggleWindow();
    });

    // quick actions hotkey
    globalShortcut.register('CommandOrControl+Shift+Q', () => {
        if (mainWindow) {
            showWindow();
            mainWindow.webContents.send('quick-action-mode');
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('will-quit', () => {
    globalShortcut.unregisterAll();
});

// ipc handlers
ipcMain.handle('get-clipboard', () => {
    return clipboard.readText();
});

ipcMain.handle('set-clipboard', (event, text) => {
    clipboard.writeText(text);
    return true;
});

ipcMain.handle('hide-window', () => {
    hideWindow();
    return true;
});

ipcMain.handle('get-settings', () => {
    return store.get('settings', {
        personality: 'concise',
        theme: 'dark',
        opacity: 0.95,
        hideOnBlur: true
    });
});

ipcMain.handle('save-settings', (event, settings) => {
    store.set('settings', settings);
    return true;
});

ipcMain.handle('get-active-window', async () => {
    return { app: 'Unknown', title: 'Active Window' };
});
