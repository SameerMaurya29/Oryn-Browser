# Oryn Browser — Current build status

## Product boundary
Oryn is an Electron + Chromium browser for Windows and macOS with a custom, calm browser chrome. It uses direct user-driven provider URLs for search and does not run a search backend, scrape result pages, or include a built-in ad blocker. Users may install trusted Chromium extensions for ad and tracker blocking.

## Implemented foundations
- Oryn new-tab, onboarding, settings, history, bookmarks, and in-page download popover
- Independent WebContentsView per tab with tab switching, closing, reordering, pinning, duplication, private tabs, and close-other-tabs
- Direct URL navigation and selectable search providers with custom HTTPS templates
- Persistent normal-session storage; in-memory private partitions
- Renderer crash recovery, guarded IPC, modern navigationHistory APIs, and repeated bounds application
- Light/dark/system theme foundation, wallpapers, layout density, and extension load/remove UI
- Static smoke tests and lint checks

## Release work still requiring runtime validation
- Full macOS and Windows manual QA: tab lifecycle, navigation, downloads, fullscreen, resize, offline errors, and renderer recovery
- Accessibility and keyboard/focus audit
- Real Manifest V3 extension compatibility checks
- Packaging and release signing: electron-builder installation, macOS notarization, Windows signing, installer testing, and update strategy
- Cross-platform performance profiling and memory-sleep policy
- Public-beta test matrix, crash reporting policy, and release checklist

## Privacy and search limits
Direct provider navigation avoids API keys, custom servers, scraping, hidden retries, and automated query loops. It cannot guarantee anonymity or prevent a provider from rate-limiting, challenging, or blocking rapid searches. No search provider should be described as unlimited or lifetime-free.
