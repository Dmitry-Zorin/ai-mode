# CHANGELOG

## [0.1.0] - Unreleased

Initial AI Mode shell, forked down from the Mason Gallery monorepo.

### added
- native macOS window pointed directly at Google AI Mode (`https://www.google.com/?udm=50`) via a Rust-built `WebviewWindowBuilder`
- Chrome user-agent spoofing and document-start CSS/JS injection (`inject.js`) to hide Google's browser chrome
- Option+Space global hotkey to toggle the window (`tauri-plugin-global-shortcut`)
- close→hide, Dock-reopen→show, single-instance focus, and persisted window geometry

### removed
- the entire Mason Gallery image viewer: the `core`/`web`/`cli` packages, the React/Vite/MUI frontend, and the Rust archive/thumbnail/database/HTTP-server backend
