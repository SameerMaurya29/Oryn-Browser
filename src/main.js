const { app, BrowserWindow, WebContentsView, ipcMain, session, shell, nativeTheme, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { fileURLToPath } = require('node:url');

// macOS Chromium GPU mailbox crashes can terminate Electron with SIGSEGV.
// Prefer the stable software compositor unless explicitly overridden for testing.
if (process.platform === 'darwin' && process.env.ORYN_HARDWARE_ACCELERATION !== '1') {
    app.disableHardwareAcceleration();
    app.commandLine.appendSwitch('disable-gpu');
    app.commandLine.appendSwitch('disable-gpu-compositing');
}

let win, active, tabs = new Map(), historyItems = [], downloadItems = [], privateDownloadItems = [], bookmarks = [], extensions = [], activeDownloads = new Map(), wiredDownloadSessions = new WeakSet();
let historyFile, downloadsFile, bookmarksFile, extensionsFile, settingsFile, sessionFile;

const search = q => {
    q = String(q || '').trim();
    if (!q) return 'https://www.google.com/';
    const hasSpaces = /\s/.test(q);
    const hasScheme = /^https?:\/\//i.test(q);
    const looksLikeDomain = /^(localhost(?::\d+)?|(?:[a-z0-9-]+\.)+[a-z]{2,})(?:[/:?#].*)?$/i.test(q);
    if (!hasSpaces && (hasScheme || looksLikeDomain)) {
        const candidate = hasScheme ? q : `https://${q}`;
        try { const u = new URL(candidate); if (['http:', 'https:'].includes(u.protocol)) return u.href; } catch {}
    }
    const providers = {
        google: 'https://www.google.com/search?q=',
        duckduckgo: 'https://duckduckgo.com/?q=',
        bing: 'https://www.bing.com/search?q=',
        brave: 'https://search.brave.com/search?q='
    };
    const custom = settingsState?.customSearchUrl;
    const candidate = settingsState?.defaultSearch === 'custom' && custom ? custom.trim() : (providers[settingsState?.defaultSearch] || providers.google);
    let endpoint = candidate;
    try {
        const parsed = new URL(endpoint);
        if (!['http:', 'https:'].includes(parsed.protocol)) endpoint = providers.google;
    } catch {
        endpoint = providers.google;
    }
    const encoded = encodeURIComponent(q);
    return endpoint.includes('{query}') ? endpoint.split('{query}').join(encoded) : endpoint + encoded;
};

function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }
function saveJson(file, value) { try { fs.writeFileSync(file, JSON.stringify(value, null, 2)); } catch (error) { console.error('Oryn storage error:', error.message); } }
function arrayOrEmpty(value) { return Array.isArray(value) ? value : []; }
function saveSession() {
    if (sessionFile) saveJson(sessionFile, settingsState.restoreTabs ? [...tabs.values()].filter(t => !t.private).map(t => t.url).filter(Boolean).slice(0, 20) : []);
}
function handle(name, listener) {
    ipcMain.handle(name, async (event, ...args) => {
        try { return await listener(event, ...args); }
        catch (error) { console.error(`Oryn IPC error [${name}]:`, error); return null; }
    });
}
function notify(channel, value) {
    if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return;
    try { win.webContents.send(channel, value); }
    catch (error) { console.error(`Oryn notification error [${channel}]:`, error.message); }
}
function notifyDownloads() { notify('downloads', [...privateDownloadItems, ...downloadItems]); }
function send() {
    notify('state', [...tabs.values()].map(t => ({
        id: t.id,
        title: t.title,
        url: t.url,
        favicon: t.favicon || '',
        loading: Boolean(t.loading),
        private: Boolean(t.private),
        pinned: Boolean(t.pinned),
        active: t.id === active
    })));
}

function isChromeWebStoreUrl(value) {
    try {
        const parsed = new URL(String(value));
        return parsed.protocol === 'https:' && (parsed.hostname === 'chromewebstore.google.com' || (parsed.hostname === 'chrome.google.com' && parsed.pathname.startsWith('/webstore')));
    } catch { return false; }
}
function visibleUrl(value) {
    return /^(?:file:|chrome-extension:)/i.test(String(value || '')) ? '' : String(value || '');
}
function isAllowedPageUrl(value) {
    try {
        const parsed = new URL(String(value));
        if (['http:', 'https:'].includes(parsed.protocol)) return true;
        if (parsed.protocol === 'chrome-extension:') return extensions.some(item => item.id === parsed.hostname);
        if (parsed.protocol !== 'file:') return false;
        const uiRoot = path.resolve(__dirname, '..', 'ui') + path.sep;
        return fileURLToPath(parsed).startsWith(uiRoot);
    } catch { return false; }
}
function extensionNewTabTarget() {
    const extension = extensions.find(item => typeof item.id === 'string' && typeof item.newTab === 'string' && item.newTab);
    return extension ? `chrome-extension://${extension.id}/${extension.newTab.replace(/^\//, '')}` : '';
}
function loadExtensionNewTab(view) {
    const target = extensionNewTabTarget();
    return target ? view.webContents.loadURL(target) : view.webContents.loadFile(path.join(__dirname, '..', 'ui', 'newtab.html'));
}
function loadTarget(view, target, isPrivate = false) {
    if (!view?.webContents || view.webContents.isDestroyed()) return Promise.resolve(false);
    let load;
    if (isChromeWebStoreUrl(target)) load = view.webContents.loadFile(path.join(__dirname, '..', 'ui', 'settings.html'));
    else if (target === 'oryn://newtab' && !isPrivate) load = loadExtensionNewTab(view);
    else if (target === 'oryn://newtab') load = view.webContents.loadFile(path.join(__dirname, '..', 'ui', 'newtab.html'));
    else if (target === 'oryn://history') load = view.webContents.loadFile(path.join(__dirname, '..', 'ui', 'history.html'));
    else if (target === 'oryn://settings' || target === 'oryn://extensions') load = view.webContents.loadFile(path.join(__dirname, '..', 'ui', 'settings.html'));
    else load = view.webContents.loadURL(search(target));
    return Promise.resolve(load).catch(error => {
        if (error?.code === 'ERR_ABORTED' || error?.errno === -3) return false;
        console.error('Oryn navigation request failed:', error.message);
        return false;
    });
}

function add(initialUrl = 'oryn://newtab', isPrivate = false) {
    const id = crypto.randomUUID();
    const preferences = {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        backgroundThrottling: true
    };
    if (isPrivate) preferences.partition = `oryn-private-${id}`;
    const v = new WebContentsView({ webPreferences: preferences });
    const tabSession = isPrivate ? session.fromPartition(preferences.partition) : session.defaultSession;
    wireDownloadSession(tabSession, isPrivate);
    const t = { id, title: isPrivate ? 'Private tab' : 'New tab', url: '', favicon: '', loading: true, private: isPrivate, partition: isPrivate ? preferences.partition : '', pinned: false, view: v };
    
    v.setBackgroundColor('#fdf6f6');
    tabs.set(id, t);
    
    v.webContents.on('page-favicon-updated', (_, icons) => {
        t.favicon = icons[0] || '';
        send();
    });
    v.webContents.on('page-title-updated', (_, x) => {
        t.title = x;
        const visit = historyItems.find(h=>h.url===t.url);
        if (visit) { visit.title = x; saveJson(historyFile, historyItems); }
        send();
    });
    v.webContents.on('did-navigate', (_, x) => {
        t.url = visibleUrl(x);
        t.loading = false;
        if (t.url && !t.private) { historyItems = [{title:t.title || 'Page', url:t.url, time:Date.now()}, ...historyItems.filter(h=>h.url!==t.url)].slice(0,100); saveJson(historyFile, historyItems); }
        applyBounds(t.view);
        send();
    });
    v.webContents.on('did-start-loading', () => { t.loading = true; applyBounds(t.view); send(); });
    v.webContents.on('did-stop-loading', () => { t.loading = false; applyBounds(t.view); send(); });
    v.webContents.on('dom-ready', () => applyBounds(t.view));
    v.webContents.on('did-navigate-in-page', (_, x) => { t.url = visibleUrl(x); applyBounds(t.view); send(); });
    v.webContents.on('did-fail-load', (_, errorCode, errorDescription, _validatedURL, isMainFrame) => { if (isMainFrame) { t.loading = false; t.title = `Page unavailable`; applyBounds(t.view); send(); console.error(`Oryn navigation error ${errorCode}: ${errorDescription}`); } });
    v.webContents.on('render-process-gone', async (_, details) => {
        console.error(`Oryn renderer exited: ${details.reason}`);
        const wasActive = t.id === active;
        const retryUrl = t.url || 'oryn://newtab';
        await clearPrivateSession(t);
        tabs.delete(t.id);
        try { t.view.webContents.close(); } catch {}
        if (wasActive) add(retryUrl, Boolean(t.private)); else send();
    });
    v.webContents.on('will-navigate', (event, url) => {
        if (isChromeWebStoreUrl(url)) { event.preventDefault(); void loadTarget(v, 'oryn://extensions', Boolean(t.private)); return; }
        if (!isAllowedPageUrl(url)) event.preventDefault();
    });
    v.webContents.on('will-redirect', (event, url) => {
        if (isChromeWebStoreUrl(url)) { event.preventDefault(); void loadTarget(v, 'oryn://extensions', Boolean(t.private)); return; }
        if (!isAllowedPageUrl(url)) event.preventDefault();
    });
    v.webContents.setWindowOpenHandler(({ url }) => {
        if (isAllowedPageUrl(url)) add(isChromeWebStoreUrl(url) ? 'oryn://extensions' : url, Boolean(t.private));
        return { action: 'deny' };
    });

    active = id;
    attach();
    void loadTarget(v, initialUrl, isPrivate);
    return t;
}

function applyBounds(view) {
    if (!view || !win || win.isDestroyed()) return;
    try {
        const [w, h] = win.getContentSize();
        view.setBounds({ x: 0, y: 114, width: Math.max(1, w), height: Math.max(1, h - 114) });
    } catch (error) {
        console.error('Oryn bounds error:', error.message);
    }
}
function attach() {
    if (!win || win.isDestroyed()) return;
    try {
        for (const t of tabs.values()) {
            if (t?.view) win.contentView.removeChildView(t.view);
        }
        const t = tabs.get(active);
        if (t?.view && !t.view.webContents.isDestroyed()) {
            win.contentView.addChildView(t.view);
            applyBounds(t.view);
        }
    } catch (error) {
        console.error('Oryn view attach error:', error.message);
    }
    send();
}

function wireDownloadSession(targetSession, isPrivate = false) {
    if (!targetSession || wiredDownloadSessions.has(targetSession)) return;
    wiredDownloadSessions.add(targetSession);
    targetSession.on('will-download', (_event, item) => {
        const filename = path.basename(String(item.getFilename() || 'download'));
        const destination = !isPrivate && settingsState.downloadsDirectory ? settingsState.downloadsDirectory : app.getPath('downloads');
        try {
            fs.mkdirSync(destination, { recursive: true });
            item.setSavePath(path.join(destination, filename));
        } catch (error) { console.error('Oryn download path error:', error.message); }
        const record = { id: crypto.randomUUID(), filename, url: item.getURL(), path: '', state: 'started', received: 0, total: item.getTotalBytes(), time: Date.now(), private: Boolean(isPrivate) };
        if (isPrivate) privateDownloadItems = [record, ...privateDownloadItems].slice(0, 20);
        else downloadItems = [record, ...downloadItems].slice(0, 100);
        activeDownloads.set(record.id, item);
        if (!isPrivate) saveJson(downloadsFile, downloadItems);
        notifyDownloads();
        item.on('updated', (_event, state) => {
            record.state = item.isPaused() ? 'paused' : state;
            record.received = item.getReceivedBytes();
            record.total = item.getTotalBytes();
            if (!isPrivate) saveJson(downloadsFile, downloadItems);
            notifyDownloads();
        });
        item.once('done', (_event, state) => {
            record.state = state;
            record.path = item.getSavePath();
            activeDownloads.delete(record.id);
            if (!isPrivate) saveJson(downloadsFile, downloadItems);
            notifyDownloads();
        });
    });
}

async function startBrowser() {
    if (!win || win.isDestroyed()) return;
    try {
        await win.loadFile(path.join(__dirname, '..', 'ui', 'index.html'));
    } catch (error) {
        console.error('Oryn chrome load error:', error.message);
        return;
    }
    if (!win || win.isDestroyed()) return;
    win.on('resize', attach);
    const restored = settingsState.restoreTabs ? arrayOrEmpty(readJson(sessionFile, [])).filter(url => typeof url === 'string' && /^(https?:|oryn:)/i.test(url)) : [];
    if (restored.length) restored.forEach(url => add(url)); else add();
}
function create() {
    win = new BrowserWindow({
        width: 1400,
        height: 850,
        backgroundColor: '#fdf6f6',
        webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false }
    });
    win.on('closed', () => { win = null; });
    if (settingsState.onboardingComplete) startBrowser();
    else win.loadFile(path.join(__dirname, '..', 'ui', 'onboarding.html'));
}


const defaultSettings = {
    clearOnExit: false,
    theme: 'system',
    wallpaper: 'aurora',
    enableAnimations: true,
    layoutDensity: 'comfortable',
    defaultSearch: 'google',
    customSearchUrl: 'https://www.google.com/search?q={query}',
    downloadsDirectory: '',
    restoreTabs: false,
    onboardingComplete: false
};
let settingsState = { ...defaultSettings };
app.whenReady().then(async () => {
    const userData = app.getPath('userData');
    historyFile = path.join(userData, 'history.json');
    downloadsFile = path.join(userData, 'downloads.json');
    bookmarksFile = path.join(userData, 'bookmarks.json');
    extensionsFile = path.join(userData, 'extensions.json');
    settingsFile = path.join(userData, 'settings.json');
    sessionFile = path.join(userData, 'session.json');
    historyItems = arrayOrEmpty(readJson(historyFile, []));
    downloadItems = arrayOrEmpty(readJson(downloadsFile, []));
    bookmarks = arrayOrEmpty(readJson(bookmarksFile, []));
    extensions = arrayOrEmpty(readJson(extensionsFile, [])).filter(item => item && typeof item.path === 'string');
    const savedSettings = readJson(settingsFile, {});
    settingsState = { ...defaultSettings, ...(savedSettings && !Array.isArray(savedSettings) && typeof savedSettings === 'object' ? savedSettings : {}) };
    for (const extension of extensions) {
        try {
            if (!fs.existsSync(extension.path)) continue;
            const manifest = JSON.parse(fs.readFileSync(path.join(extension.path, 'manifest.json'), 'utf8'));
            const loaded = await session.defaultSession.loadExtension(extension.path);
            extension.id = loaded.id;
            extension.name = loaded.name;
            extension.version = loaded.version;
            extension.newTab = typeof manifest.chrome_url_overrides?.newtab === 'string' ? manifest.chrome_url_overrides.newtab : '';
        } catch (error) { console.error('Oryn extension load error:', error.message); }
    }
    saveJson(extensionsFile, extensions);
    nativeTheme.themeSource = settingsState.theme === 'light' || settingsState.theme === 'dark' ? settingsState.theme : 'system';
    wireDownloadSession(session.defaultSession);
    create();
});

app.on('before-quit', () => {
    saveSession();
    if (settingsState.clearOnExit && historyFile) { historyItems = []; saveJson(historyFile, historyItems); }
});
app.on('window-all-closed', () => app.quit());

async function clearPrivateSession(tab) {
    if (!tab?.private || !tab.partition) return;
    try {
        const privateSession = session.fromPartition(tab.partition);
        await privateSession.clearCache();
        await privateSession.clearStorageData({ storages: ['appcache', 'cookies', 'localstorage', 'serviceworkers', 'shadercache', 'websql'] });
    } catch (error) { console.error('Oryn private-session cleanup error:', error.message); }
}

handle('command', async (_, name) => {
    const t = tabs.get(active);
    if (name === 'new') add();
    else if (name === 'private') add('oryn://newtab', true);
    else if (name === 'duplicate' && t) add(t.url || 'oryn://newtab', Boolean(t.private));
    else if (name === 'close' && t) { await clearPrivateSession(t); tabs.delete(t.id); t.view.webContents.close(); if (!tabs.size) return app.quit(); active = tabs.keys().next().value; attach(); }
    else if (name === 'address') notify('focus-address');
    return true;
});
handle('finish-onboarding', () => {
    settingsState.onboardingComplete = true;
    saveJson(settingsFile, settingsState);
    if (win && !win.isDestroyed()) startBrowser();
    return true;
});
handle('get-history', () => historyItems);
handle('clear-history', () => { historyItems = []; saveJson(historyFile, historyItems); return true; });
handle('get-downloads', () => [...privateDownloadItems, ...downloadItems]);
handle('get-extensions', () => extensions);
handle('install-extension', async () => {
    if (!win || win.isDestroyed()) return { ok: false, extensions, error: 'Oryn is closing.' };
    const result = await dialog.showOpenDialog(win, { properties: ['openDirectory'], title: 'Choose an unpacked Chromium extension' });
    if (result.canceled || !result.filePaths[0]) return { ok: false, extensions, error: 'Extension installation cancelled.' };
    const extensionPath = path.resolve(result.filePaths[0]);
    const manifestPath = path.join(extensionPath, 'manifest.json');
    if (!fs.existsSync(manifestPath)) return { ok: false, extensions, error: 'Choose an unpacked extension folder containing manifest.json. Chrome Web Store links and .crx files are not supported yet.' };
    let manifest;
    try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); }
    catch { return { ok: false, extensions, error: 'The extension manifest.json is invalid JSON.' }; }
    if (!manifest || typeof manifest !== 'object' || typeof manifest.manifest_version !== 'number') return { ok: false, extensions, error: 'The extension manifest.json is missing a valid manifest_version.' };
    try {
        const loaded = await session.defaultSession.loadExtension(extensionPath);
        const record = { id: loaded.id, name: loaded.name, version: loaded.version, path: extensionPath, newTab: typeof manifest.chrome_url_overrides?.newtab === 'string' ? manifest.chrome_url_overrides.newtab : '' };
        extensions = [...extensions.filter(item => item.id !== record.id), record];
        saveJson(extensionsFile, extensions);
        for (const tab of tabs.values()) if (!tab.private && tab.view?.webContents && !tab.view.webContents.isDestroyed()) {
            const page = tab.view.webContents.getURL();
            if (/^https?:/i.test(page)) { try { tab.view.webContents.reload(); } catch {} }
            else if (page.endsWith('/ui/newtab.html')) void loadTarget(tab.view, 'oryn://newtab');
        }
        return { ok: true, extensions };
    } catch (error) { return { ok: false, extensions, error: `Could not load extension: ${error.message}` }; }
});
handle('remove-extension', (_, id) => {
    const extension = extensions.find(item => item.id === String(id || ''));
    if (extension) { try { session.defaultSession.removeExtension(extension.id); } catch {} }
    extensions = extensions.filter(item => item.id !== String(id || ''));
    saveJson(extensionsFile, extensions);
    for (const tab of tabs.values()) if (!tab.private && tab.view?.webContents && !tab.view.webContents.isDestroyed()) {
        const page = tab.view.webContents.getURL();
        if (/^https?:/i.test(page)) { try { tab.view.webContents.reload(); } catch {} }
        else if (page.startsWith('chrome-extension://')) void loadTarget(tab.view, 'oryn://newtab');
    }
    return { ok: true, extensions };
});
handle('download-action', (_, id, action) => {
    const item = activeDownloads.get(String(id || ''));
    if (!item || !['pause', 'resume', 'cancel'].includes(action)) return false;
    if (action === 'pause' && !item.isPaused()) item.pause();
    if (action === 'resume' && item.isPaused()) item.resume();
    if (action === 'cancel') item.cancel();
    return true;
});
handle('open-download', async (_, id) => {
    const record = downloadItems.find(item => item.id === String(id || ''));
    if (!record?.path || !fs.existsSync(record.path)) return false;
    await shell.openPath(record.path); return true;
});
handle('reveal-download', (_, id) => {
    const record = downloadItems.find(item => item.id === String(id || ''));
    if (!record?.path || !fs.existsSync(record.path)) return false;
    shell.showItemInFolder(record.path); return true;
});
handle('get-bookmarks', () => bookmarks);
handle('toggle-bookmark', (_, value) => {
    if (!value || typeof value.url !== 'string' || !/^https?:/i.test(value.url)) return bookmarks;
    const existing = bookmarks.findIndex(item => item.url === value.url);
    if (existing >= 0) bookmarks.splice(existing, 1);
    else bookmarks.unshift({ url: value.url, title: String(value.title || value.url).slice(0, 200), favicon: String(value.favicon || ''), time: Date.now() });
    bookmarks = bookmarks.slice(0, 500);
    saveJson(bookmarksFile, bookmarks);
    return bookmarks;
});
handle('remove-bookmark', (_, url) => {
    bookmarks = bookmarks.filter(item => item.url !== String(url || ''));
    saveJson(bookmarksFile, bookmarks);
    return bookmarks;
});
handle('get-settings', () => settingsState);
handle('save-settings', (_, value) => {
    if (!value || typeof value !== 'object') return settingsState;
    const next = { ...settingsState };
    if (typeof value.clearOnExit === 'boolean') next.clearOnExit = value.clearOnExit;
    if (typeof value.restoreTabs === 'boolean') next.restoreTabs = value.restoreTabs;
    if (['light', 'dark', 'system'].includes(value.theme)) next.theme = value.theme;
    if (['aurora', 'dawn', 'rose', 'ocean', 'midnight'].includes(value.wallpaper)) next.wallpaper = value.wallpaper;
    if (typeof value.enableAnimations === 'boolean') next.enableAnimations = value.enableAnimations;
    if (['compact', 'comfortable'].includes(value.layoutDensity)) next.layoutDensity = value.layoutDensity;
    if (['google', 'duckduckgo', 'bing', 'brave', 'custom'].includes(value.defaultSearch)) next.defaultSearch = value.defaultSearch;
    if (typeof value.customSearchUrl === 'string' && /^https?:\/\//i.test(value.customSearchUrl) && value.customSearchUrl.includes('{query}')) next.customSearchUrl = value.customSearchUrl.trim();
    if (typeof value.downloadsDirectory === 'string') next.downloadsDirectory = value.downloadsDirectory.trim();
    settingsState = next;
    nativeTheme.themeSource = settingsState.theme === 'light' || settingsState.theme === 'dark' ? settingsState.theme : 'system';
    saveJson(settingsFile, settingsState);
    notify('settings', settingsState);
    return settingsState;
});
handle('clear-browsing-data', async () => {
    historyItems = [];
    saveJson(historyFile, historyItems);
    await session.defaultSession.clearCache();
    await session.defaultSession.clearStorageData({ storages: ['appcache', 'cookies', 'localstorage', 'serviceworkers', 'shadercache', 'websql'] });
    return true;
});
handle('state', () => [...tabs.values()].map(t => ({
    id: t.id,
    title: t.title,
    url: t.url,
    favicon: t.favicon || '',
    loading: Boolean(t.loading),
    private: Boolean(t.private),
    pinned: Boolean(t.pinned),
    active: t.id === active
})));

handle('new-tab', (_, url) => { add(url); });
handle('new-private-tab', (_, url) => { add(url, true); });
handle('activate', (_, id) => {
    if (tabs.has(id)) {
        active = id;
        attach();
    }
});
handle('reorder-tabs', (_, fromId, toId) => {
    if (!tabs.has(fromId) || !tabs.has(toId) || fromId === toId) return false;
    const ordered = [...tabs.entries()];
    const fromIndex = ordered.findIndex(([id]) => id === fromId);
    const [moved] = ordered.splice(fromIndex, 1);
    const toIndex = ordered.findIndex(([id]) => id === toId);
    ordered.splice(toIndex, 0, moved);
    tabs = new Map(ordered);
    attach();
    return true;
});
handle('pin-tab', (_, id) => {
    const t = tabs.get(id); if (!t) return false;
    t.pinned = !t.pinned;
    const ordered = [...tabs.entries()].sort((a, b) => Number(b[1].pinned) - Number(a[1].pinned));
    tabs = new Map(ordered); attach(); return t.pinned;
});
handle('duplicate-tab', (_, id) => {
    const t = tabs.get(id); if (!t) return false;
    add(t.url || 'oryn://newtab', Boolean(t.private)); return true;
});
handle('close-other-tabs', async (_, id) => {
    if (!tabs.has(id)) return false;
    for (const [tabId, t] of tabs) if (tabId !== id && !t.pinned) { await clearPrivateSession(t); t.view.webContents.close(); tabs.delete(tabId); }
    active = id; attach(); return true;
});
handle('navigate', (_, q) => {
    const t = tabs.get(active);
    if (!t) return;
    t.title = 'Loading…'; t.favicon = ''; t.loading = true; send();
    void loadTarget(t.view, String(q || '').trim(), Boolean(t.private));
});
handle('back', () => {
    const t = tabs.get(active); if (!t?.view?.webContents || t.view.webContents.isDestroyed()) return false;
    const history = t.view.webContents.navigationHistory;
    if (history.canGoBack()) { history.goBack(); applyBounds(t.view); setTimeout(() => { if (t.id === active) { applyBounds(t.view); attach(); } }, 50); return true; }
    return false;
});
handle('forward', () => {
    const t = tabs.get(active); if (!t?.view?.webContents || t.view.webContents.isDestroyed()) return false;
    const history = t.view.webContents.navigationHistory;
    if (history.canGoForward()) { history.goForward(); applyBounds(t.view); setTimeout(() => { if (t.id === active) { applyBounds(t.view); attach(); } }, 50); return true; }
    return false;
});
handle('reload', () => { const t=tabs.get(active); if(t?.view?.webContents && !t.view.webContents.isDestroyed()){ t.view.webContents.reload(); applyBounds(t.view); return true; } return false; });
handle('close', async (_, id) => {
    const t = tabs.get(id);
    if (!t) return false;
    await clearPrivateSession(t);
    tabs.delete(id);
    t.view.webContents.close();
    if (tabs.size === 0) return app.quit();
    if (active === id) active = tabs.keys().next().value;
    attach();
    return true;
});
