const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('main process uses modern navigation history APIs', () => {
    const main = read('src/main.js');
    assert.match(main, /\.navigationHistory/);
    assert.match(main, /history\.canGoBack\(\)/);
    assert.match(main, /history\.canGoForward\(\)/);
    assert.doesNotMatch(main, /webContents\.canGoBack|webContents\.canGoForward/);
});

test('internal UI entrypoints exist and are connected', () => {
    for (const file of ['ui/index.html', 'ui/newtab.html', 'ui/history.html', 'ui/settings.html', 'ui/onboarding.html']) assert.ok(fs.existsSync(path.join(root, file)), file);
    assert.match(read('ui/index.html'), /id="tabs"/);
    assert.match(read('ui/index.html'), /id="downloads"/);
});

test('download actions stay local to Electron shell handlers', () => {
    const main = read('src/main.js');
    assert.match(main, /shell\.openPath/);
    assert.match(main, /shell\.showItemInFolder/);
    assert.match(main, /download-action/);
    assert.doesNotMatch(main, /new BrowserWindow\([^)]*download/i);
});

test('search provider templates encode a query placeholder', () => {
    const main = read('src/main.js');
    assert.match(main, /duckduckgo:/);
    assert.match(main, /bing:/);
    assert.match(main, /brave:/);
    assert.match(main, /customSearchUrl/);
    assert.match(main, /encodeURIComponent\(q\)/);
});

test('preload remains isolated and remote pages do not receive the bridge', () => {
    const preload = read('src/preload.js');
    assert.match(preload, /contextBridge\.exposeInMainWorld/);
    assert.match(preload, /window\.location\.protocol !== 'file:'/);
    assert.doesNotMatch(preload, /nodeIntegration/);
});

test('removed legacy UI and startup regressions are absent', () => {
    const main = read('src/main.js');
    const app = read('ui/app.js');
    assert.match(main, /require\('node:crypto'\)/);
    assert.doesNotMatch(main, /closePanel/);
    assert.doesNotMatch(main, /search\.tiekoetter|SearXNG/);
    assert.doesNotMatch(app, /google\.com\/s2\/favicons/);
    assert.doesNotMatch(read('ui/index.html'), /workspace-pill|class="apps"|edge-trigger/);
});
