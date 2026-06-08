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

### Removed
