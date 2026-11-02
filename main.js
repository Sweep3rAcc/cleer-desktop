const { app, BrowserWindow, shell, session } = require('electron');
const path = require('path');
const { isSupabaseAuthorize, startGoogleSignIn, closeServer } = require('./auth-bridge');

// The app opens your live site, so every deploy reaches the desktop app too.
// To try local changes first:  set CLEER_URL=http://localhost:8081  (see README).
const APP_URL = process.env.CLEER_URL || 'https://www.cleer.app';
const APP_HOST = new URL(APP_URL).hostname;

// Hosts that may load inside the app window (the site itself plus sign-in).
function isInternal(url) {
  try {
    const host = new URL(url).hostname;
    return (
      host === APP_HOST ||
      host.endsWith('.' + APP_HOST.replace(/^www\./, '')) ||
      host === 'localhost' ||
      host.endsWith('.supabase.co') ||
      host === 'accounts.google.com' ||
      host.endsWith('.google.com')
    );
  } catch {
    return false;
  }
}

// Google refuses sign-in from browsers that announce themselves as "Electron".
// Present as plain Chrome instead.
function cleanUserAgent(ua) {
  return ua.replace(/\sElectron\/\S+/, '').replace(/\s(Cleer|cleer-desktop)\/\S+/i, '');
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 420,
    minHeight: 600,
    backgroundColor: '#14141e',
    title: 'Cleer',
    icon: path.join(__dirname, 'build', 'icon.png'),
    autoHideMenuBar: true, // press Alt to show the menu
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const ua = cleanUserAgent(win.webContents.getUserAgent());
  win.webContents.setUserAgent(ua);
  session.defaultSession.setUserAgent(ua);

  // Links that leave the site open in the normal browser, not in the app.
  // Google sign-in is done in the normal browser (see auth-bridge.js).
  const interceptSignIn = (url) => {
    if (!isSupabaseAuthorize(url)) return false;
    startGoogleSignIn(url, { win, appUrl: APP_URL, openExternal: (u) => shell.openExternal(u) });
    return true;
  };

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (interceptSignIn(url)) return { action: 'deny' };
    if (isInternal(url)) return { action: 'allow' };
    shell.openExternal(url);
    return { action: 'deny' };
  });
  const onNavigate = (event, url) => {
    if (interceptSignIn(url)) { event.preventDefault(); return; }
    if (!isInternal(url) && !url.startsWith('file://')) {
      event.preventDefault();
      shell.openExternal(url);
    }
  };
  win.webContents.on('will-navigate', onNavigate);
  win.webContents.on('will-redirect', onNavigate);

  // No internet when opening: show a small "offline" page that retries itself.
  win.webContents.on('did-fail-load', (_e, code, _desc, _url, isMainFrame) => {
    if (isMainFrame && code !== -3) {
      win.loadFile(path.join(__dirname, 'offline.html'), { query: { url: APP_URL } });
    }
  });

  win.loadURL(APP_URL);
}

// One window at a time: opening the app again just brings the first one forward.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.whenReady().then(() => {
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
  app.on('before-quit', closeServer);
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
