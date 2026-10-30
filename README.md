# Burno

A simple desktop API client (Bruno-like), built with **Tauri 2** (Rust) + **React / TypeScript**.
Runs on macOS, Windows and Linux.

## Dev

```bash
npm install
npm run tauri dev
```

## Build an installer for the current OS

```bash
npm run tauri build
```

Output goes to `src-tauri/target/release/bundle/` (.dmg/.app on macOS, .msi/.exe on Windows, .deb/.AppImage on Linux).

## Structure

- `src-tauri/src/lib.rs` — `send_request` command: sends HTTP requests from Rust (reqwest), so no CORS limits.
- `src/api.ts` — calls the Rust command from the UI.
- `src/types.ts` — request/response types.
- `src/storage.ts` — saves requests in localStorage.
- `src/components/` — Sidebar, RequestEditor, KeyValueEditor, ResponseViewer.
