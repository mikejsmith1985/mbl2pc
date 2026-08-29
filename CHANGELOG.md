# Changelog — mbl2pc

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Forge Workflow initialized with Forge Terminal Workflow Architect
- React + TypeScript + Vite frontend replacing the vanilla `send.html` implementation.
  All existing features preserved: theming (5 palettes × light/dark), SSE real-time updates,
  per-sender colour bubbles, markdown rendering, file/image upload, snippets, clipboard sync,
  starred/pinned messages, multi-select, search, and date filtering.
- `frontend/` directory with Zustand state, typed API layer, and 14 React components.

### Changed
- **The Snippets panel starts collapsed.** An open snippet list pushed the
  conversation off a phone screen before a single message could be read; the
  header still shows the snippet count and one tap opens it.
- `render.yaml` build command now runs `npm ci --prefix frontend && npm run --prefix frontend build`
  before the Python install step so Render builds the React assets automatically.

### Fixed
- **A clipboard image is no longer lost when one of its formats is unreadable.**
  Safari advertises private formats alongside the real image and throws when asked
  for them; each format is now tried independently, so one refusal moves on to the
  next instead of abandoning the whole paste and falling back to plain text.
- **Pastes and drops confirm what they attached.** A paste that produced nothing
  used to look identical to one that worked, so the clipboard button now says
  "Nothing on the clipboard to paste" when the clipboard is empty, and attaching a
  file shows its name.
- **Enter now sends a message on desktop.** Previously only Ctrl/Cmd+Enter sent,
  so pressing Enter inserted a newline. On a desktop Enter sends and Shift+Enter
  inserts the newline; on a phone or tablet the return key is left alone, because
  a soft keyboard has no Shift+Enter and would otherwise make a second line
  impossible to type. Ctrl/Cmd+Enter still sends everywhere. Enter is ignored
  mid-IME-composition so it does not truncate Japanese, Chinese, or accented input.
- **Pasting images, videos, and files now works.** The composer had no paste
  handler at all, and the clipboard button could only read plain text. Pasting
  into the message box or anywhere on the page now attaches the files, as does a
  drag-and-drop; the clipboard button reads image and file blobs via
  `navigator.clipboard.read()` before falling back to text. Clipboard items that
  arrive without a filename (most screenshots) get one synthesised from their MIME
  type, which the upload endpoints require.
- **Uploads that failed now say why.** An oversized file is rejected in the browser
  with its name and size instead of uploading for a minute and failing with a
  generic "Failed to send", and backend rejections surface their own `detail` text.
- **Filenames with spaces, accents, or emoji no longer break uploads.** Supabase
  Storage keys are now sanitised, while the original name is still what the chat
  displays.
- **An iOS home-screen app no longer needs a force-quit to catch up.** Three causes
  were addressed: the SSE stream is rebuilt and messages refetched whenever the app
  is resumed, comes back online, or its heartbeat goes silent — iOS tears the
  connection down without ever firing an `error` event, so nothing used to
  reconnect; the app reloads itself once when a resume finds the server on a newer
  commit; and `/send.html` and `/version` are served uncached so a device cannot
  pin itself to a stale build.
- The SSE keepalive is now a real `heartbeat` data frame rather than an SSE comment,
  because `EventSource` never surfaces comments to the page — leaving the client no
  way to tell a live stream from a dead one.
- The service worker registered by the pre-React app is now unregistered and its
  caches purged on load; the React app serves everything from the network, but a
  worker left over from an old deploy stayed in control and could keep serving
  cached files indefinitely.
- Supabase free-tier project pausing, which took the app offline for months. The
  startup keepalive pinged `/health`, an endpoint that returns a static response
  and never queries the database — so it kept Render's web service awake while
  Supabase counted the project as inactive and paused it after 7 days. Supabase
  never resumes a paused project on its own; it requires a manual dashboard
  restore. The keepalive now targets `/internal/keepalive`, which performs a
  deliberate single-row read so the database registers real activity. `/health`
  stays database-free because Render uses it as its liveness probe, and a
  database blip must not be reported as the web service being down.
- Blank white screen on production (`mbl2pc.onrender.com`) caused by the React JS
  bundle 404-ing. `static/assets/` was gitignored so Render's Python service never
  had the built files. Built assets are now committed to the repository so the app
  works on any host without requiring a Node.js build step at deploy time.
- `tsc -b` TypeScript error in `vite.config.ts` caused by `defineConfig` being
  imported from `vite` instead of `vitest/config`; the latter correctly extends
  the config type with the `test` property required by Vitest.
- Pre-commit hook now correctly excludes `static/assets/` from the "new source
  file must have a test" gate (compiled bundles are not authored source code).
- Pre-commit "new source file must have a test" gate no longer blocks every new
  Python file. It matched test files by suffix only (`_test.py`), so pytest's
  standard `test_*.py` prefix — the convention this repo already uses in
  `test_api.py` and `test_local.py` — was read as untested source. The gate also
  sent non-Go files down a JS/TS branch that looked for `foo.test.py`, which is
  not a Python convention, so no new `.py` file could ever satisfy it.

### Removed
