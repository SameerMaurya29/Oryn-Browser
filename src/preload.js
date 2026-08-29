const { contextBridge, ipcRenderer } = require('electron');

// The preload is attached to every tab for internal pages, but remote websites
// must never receive Oryn's privileged browser-control bridge.
if (window.location.protocol !== 'file:') {
    // Keep the remote page isolated without exposing contextBridge or ipcRenderer.
} else {
    contextBridge.exposeInMainWorld('oryn', {
        finishOnboarding: () => ipcRenderer.invoke('finish-onboarding'),
        getHistory: () => ipcRenderer.invoke('get-history'),
        clearHistory: () => ipcRenderer.invoke('clear-history'),
        getDownloads: () => ipcRenderer.invoke('get-downloads'),
        getExtensions: () => ipcRenderer.invoke('get-extensions'),
        installExtension: () => ipcRenderer.invoke('install-extension'),
        removeExtension: id => ipcRenderer.invoke('remove-extension', id),
        downloadAction: (id, action) => ipcRenderer.invoke('download-action', id, action),
        onDownloads: fn => ipcRenderer.on('downloads', (_, value) => fn(value)),
        onSettings: fn => ipcRenderer.on('settings', (_, value) => fn(value)),
        openDownload: id => ipcRenderer.invoke('open-download', id),
        revealDownload: id => ipcRenderer.invoke('reveal-download', id),
        getBookmarks: () => ipcRenderer.invoke('get-bookmarks'),
        toggleBookmark: value => ipcRenderer.invoke('toggle-bookmark', value),
        removeBookmark: url => ipcRenderer.invoke('remove-bookmark', url),
        getSettings: () => ipcRenderer.invoke('get-settings'),
        saveSettings: value => ipcRenderer.invoke('save-settings', value),
        clearBrowsingData: () => ipcRenderer.invoke('clear-browsing-data'),
        state: () => ipcRenderer.invoke('state'),
        newTab: url => ipcRenderer.invoke('new-tab', url),
        newPrivateTab: url => ipcRenderer.invoke('new-private-tab', url),
        navigate: value => ipcRenderer.invoke('navigate', String(value || '')),
        back: () => ipcRenderer.invoke('back'),
        forward: () => ipcRenderer.invoke('forward'),
        reload: () => ipcRenderer.invoke('reload'),
        close: id => ipcRenderer.invoke('close', id),
        activate: id => ipcRenderer.invoke('activate', id),
        reorderTabs: (fromId, toId) => ipcRenderer.invoke('reorder-tabs', fromId, toId),
        pinTab: id => ipcRenderer.invoke('pin-tab', id),
        duplicateTab: id => ipcRenderer.invoke('duplicate-tab', id),
        closeOtherTabs: id => ipcRenderer.invoke('close-other-tabs', id),
        onState: fn => ipcRenderer.on('state', (_, value) => fn(value))
    });
}
