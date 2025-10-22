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
        transparent: true, // ✅ KEEP - Transparent background
        frame: false, // ✅ KEEP - No window frame
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: true,
        show: false,
        hasShadow: false, // ✅ KEEP - No shadow
        backgroundColor: '#00000000', // ✅ ADD - Fully transparent hex color
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            backgroundThrottling: false, // ✅ ADD - Prevent throttling when hidden
            offscreen: false
        }
    });
    
    mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
    
    // ✅ Wait for ready to show, then apply additional settings
    mainWindow.webContents.on('did-finish-load', () => {
        // Inject CSS to ensure no white borders
        mainWindow.webContents.insertCSS(`
            body {
                margin: 0 !important;
                padding: 0 !important;
                overflow: hidden !important;
                background: transparent !important;
            }
        `);
    });
    
    // Platform-specific screen capture exclusion
    if (process.platform === 'darwin') {
        mainWindow.setWindowLevel('screen-saver');
        
        try {
            mainWindow.setContentProtection(true);
        } catch (e) {
            console.log('Content protection not available');
        }
    }
    
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
            
            // ✅ Windows-specific: Remove any native borders
            if (process.platform === 'win32') {
                const { systemPreferences } = require('electron');
                // Additional Windows transparency handling
            }
        });
    }
    
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
    
    const ret = globalShortcut.register('CommandOrControl+Space', () => {
        toggleWindow();
    });
    
    if (!ret) {
        console.log('Global shortcut registration failed');
    }
    
    globalShortcut.register('Alt+A', () => {
        toggleWindow();
    });
    
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

// IPC Handlers
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
