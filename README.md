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

## Features

- Methods GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS, query params synced with the URL
- Body: JSON, XML, Text, Form URL Encoded, Multipart (text + files)
- Auth: Basic, Bearer, API Key (header or query), OAuth 2.0
  - Grants: Authorization Code (+ PKCE S256), Client Credentials, Password, Implicit
  - Login opens in an in-app window; the redirect to the Callback URL is intercepted
  - Token auto-fetch, auto-refresh with refresh_token, token in header or query
- Collections saved on disk (like Bruno), with nested folders: create, open, rename, duplicate, delete (to the trash)
- Variables (`{{name}}`) in every field, highlighted, explained on hover and auto-completed after `{{`
  - Global environments (all collections, stored on this machine)
  - Collection environments (`environments/*.json` in the collection) and collection variables (`burno.json`)
  - Request variables (Vars tab), `.env` values as `{{process.env.KEY}}`, dynamic `{{$guid}}`, `{{$timestamp}}`…
  - Variables can reference each other; secret variables are masked and never written to files
- Per-request settings: timeout, follow redirects, verify SSL
- Response: status, time, size, pretty JSON, headers, and the exact request sent

## Collections on disk

A collection is a plain folder you can commit to git:

```
My API/
├── burno.json          # { "name": "My API", "version": 1, "variables": [...] }
├── .env                # optional, read as {{process.env.KEY}} — keep it out of git
├── environments/
│   ├── Dev.json        # { "name": "Dev", "variables": [...] }
│   └── Prod.json
├── Health.json         # one file per request
└── users/              # folders group requests
    └── Get user.json
```

- Edits are saved automatically (400 ms after you stop typing).
- OAuth tokens and secret variable values are **not** written to these files; they stay on this machine.
- Variable precedence, highest first: request variables › collection environment › collection variables › global environment.
- The first launch creates `My Collection` in the app data folder
  (`~/Library/Application Support/com.burno.app/collections` on macOS) and moves older requests into it.
- "Open" adds any folder that contains a `burno.json`; closing a collection only removes it from the sidebar.

## Structure

- `src-tauri/src/lib.rs` — Rust commands: `send_request` (reqwest, no CORS limits) and `oauth2_authorize` (login window).
- `src-tauri/src/collections.rs` — reading/writing collections on disk (paths can't escape the collection).
- `src/collections.ts` — `useCollections` hook: tree, autosave, rename/delete, migration.
- `src/api.ts` — calls the Rust commands from the UI.
- `src/prepare.ts` — turns a request into what is sent: variables, body, auth.
- `src/oauth2.ts` — OAuth 2.0 flows, PKCE, refresh.
- `src/interpolate.ts` — variable scopes, nested resolution, dynamic variables, `{{variable}}` replacement.
- `src/environments.ts` — `useEnvironments` hook: global and collection environments, secrets, active selection.
- `src/url.ts` — URL ⇄ query params sync.
- `src/types.ts` — data model; `src/storage.ts` — localStorage (environments, UI state, OAuth tokens).
- `src/components/` — UI (Sidebar, RequestEditor, BodyEditor, AuthEditor, OAuth2Editor, SettingsEditor, EnvironmentModal, EnvPicker, VarInput, ResponseViewer).
