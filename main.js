const { app, BrowserWindow, globalShortcut, ipcMain, screen, clipboard, desktopCapturer, session } = require('electron');
const path = require('path');
const Store = require('electron-store');

const store = new Store();
let mainWindow = null;
let isVisible = false;

function createWindow() {
    const { width, height } = screen.getPrimaryDisplay().workAreaSize;

    mainWindow = new BrowserWindow({
        width: 380,
        height: 600,
        minWidth: 350,
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


    if (process.platform === 'darwin') {
        mainWindow.setWindowLevel('screen-saver');
        try {
            mainWindow.setContentProtection(true);
        } catch (e) {
            console.log('Content protection not available');
        }
    }

    // windows
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

    // screen capture hotkey
    globalShortcut.register('CommandOrControl+Shift+S', () => {
        if (mainWindow) {
            showWindow();
            mainWindow.webContents.send('capture-screen-mode');
        }
    });

    // listening mode hotkey (system audio capture)
    globalShortcut.register('CommandOrControl+Shift+L', () => {
        if (mainWindow) {
            showWindow();
            mainWindow.webContents.send('listening-mode-toggle');
        }
    });

    // handle display media requests for system audio loopback
    session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
        desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
            if (sources.length > 0) {
                callback({ video: sources[0], audio: 'loopback' });
            } else {
                callback({ video: null, audio: null });
            }
        }).catch((error) => {
            console.error('Display media error:', error);
            callback({ video: null, audio: null });
        });
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

// screen capture handler
ipcMain.handle('capture-screen', async () => {
    try {
        // hide our window temporarily to avoid capturing it
        const wasVisible = isVisible;
        if (wasVisible && mainWindow) {
            mainWindow.hide();
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        const sources = await desktopCapturer.getSources({
            types: ['screen'],
            thumbnailSize: { width: 1920, height: 1080 }
        });

        // show window again
        if (wasVisible && mainWindow) {
            mainWindow.show();
        }

        if (sources.length === 0) {
            return { error: 'No screen sources found' };
        }

        // get primary screen
        const primarySource = sources[0];
        const thumbnail = primarySource.thumbnail;

        // convert to base64
        const dataUrl = thumbnail.toDataURL();

        return {
            success: true,
            image: dataUrl,
            name: primarySource.name
        };
    } catch (error) {
        console.error('Screen capture failed:', error);
        return { error: error.message };
    }
});
