# Oryn Browser

Oryn is a calm, privacy-focused Electron browser for macOS, Windows, and Linux.

## Download

Public release artifacts are attached to GitHub Releases:

- macOS Apple Silicon: `.dmg`
- Windows 64-bit: `.exe`
- Linux: `.AppImage` and `.deb`

The current beta is unsigned. macOS and Windows may show an operating-system security warning until production signing certificates are configured.

## Search and privacy

Oryn uses direct user-submitted search-provider URLs. It does not run a search backend, scrape search results, prefetch queries, or automatically retry searches. Google, DuckDuckGo, Bing, Brave Search, and custom HTTPS templates are available in Settings. No provider is guaranteed to be unlimited or lifetime-free.

Oryn does not include a built-in ad blocker. Users may install trusted Chromium extensions for ad and tracker blocking.

## Package-manager files

- `distribution/homebrew/Casks/oryn.rb.template` is the Homebrew Cask template.
- `distribution/scoop/oryn.json.template` is the Scoop manifest template.
- Release automation generates checksums and release artifacts. A separate public Homebrew tap and Scoop bucket repository are required before commands such as `brew install --cask oryn` or `scoop install oryn` can work globally.

## Development

```bash
npm ci
npm run icons
npm start
npm test
```

Build targets:

```bash
npm run dist:mac
npm run dist:win
npm run dist:linux
```
