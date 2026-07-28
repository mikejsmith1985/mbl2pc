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
- `render.yaml` build command now runs `npm ci --prefix frontend && npm run --prefix frontend build`
  before the Python install step so Render builds the React assets automatically.

### Fixed
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
