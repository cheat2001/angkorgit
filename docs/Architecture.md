# Architecture

AngKorGit follows Clean Architecture with feature-based folders. Dependencies point inward: UI → application state → domain; the Rust engine is behind a single typed IPC boundary.

```
┌─────────────────────────────────────────────────────────────┐
│  React UI (apps/desktop/src)                                │
│  features/* — repository, graph, commit, diff, conflicts,   │
│               sidebar, terminal, settings, ai               │
│  components/* — Toolbar, CommandPalette (app-level shell)   │
├─────────────────────────────────────────────────────────────┤
│  State: Zustand stores per feature (repository, graph, ui,  │
│  settings) — no cross-feature imports of internals          │
├─────────────────────────────────────────────────────────────┤
│  Domain: @angkorgit/core (pure TypeScript, no React)        │
│  git types · graph lane layout · word diff · conflict       │
│  parser · AI provider registry + capabilities               │
├─────────────────────────────────────────────────────────────┤
│  IPC boundary: src/core/ipc.ts (typed commands)             │
│  Tauri invoke ⇄ Rust — or demo backend in a plain browser   │
├─────────────────────────────────────────────────────────────┤
│  Rust engine (apps/desktop/src-tauri)                       │
│  commands.rs (thin) → core/* (repo, history, stage, commit, │
│  branch, remote, misc, diff, conflict) over git2/libgit2    │
│  + terminal.rs (portable-pty) + http.rs (AI proxy)          │
└─────────────────────────────────────────────────────────────┘
```

## Key decisions

**Tauri v2 + libgit2 (git2-rs).** A native Rust engine gives sub-millisecond status/diff operations and avoids shelling out to `git` for hot paths. `vendored-libgit2` keeps builds hermetic across macOS/Windows/Linux. Every command runs on a blocking thread (`spawn_blocking`) so the UI thread never waits on I/O.

**One typed IPC surface.** `src/core/ipc.ts` is the only place that calls `invoke`. It also ships a deterministic demo backend used when the app runs in a plain browser — this is what makes UI development and Playwright e2e possible without a native build.

**Graph layout in the domain layer.** Lane assignment (`GraphLayout`) is pure TypeScript, incremental, and unit-tested. Feeding page N+1 never changes rows from page N, which keeps the virtualized list stable while history streams in. Rendering is a per-row SVG slice — O(visible rows), regardless of repository size.

**Performance strategy for 100k commits.**
- History is paginated (200 commits per request) via libgit2 revwalk; filters run engine-side.
- `@tanstack/react-virtual` renders only visible rows; rows are `memo`ized.
- Ref decorations are computed once per page in Rust, not per row in JS.
- Diffs load lazily per selected file/commit; images stream as base64 only when an image diff is opened.

**Conflict resolution as data.** Conflicted files are parsed into text/conflict blocks (`parseConflicts`), the resolver mutates block resolutions, and `serializeResolution` writes the result. Unresolved blocks re-emit their markers, so a half-finished session never destroys data.

**AI is an adapter registry.** Features call capabilities (`generateCommitMessage`, `explainConflict`, …) against the `AiProvider` interface. Providers (OpenAI, Anthropic, Gemini, Ollama, LM Studio) are created from config; HTTP goes through an injected transport implemented by a Rust proxy (no CORS, keys stay out of webview fetch). Adding a provider touches exactly one file.

## Extension points (future features)

- **Plugins** — the command palette, sidebar sections and inspector tabs are list-driven; a plugin host can contribute entries without touching feature internals. The IPC layer is a single object that can be wrapped/instrumented.
- **Forge integrations (GitHub/GitLab/Azure/Bitbucket)** — planned as `packages/forge` with one adapter per provider mirroring the AI registry pattern; PR/issue viewers become new `features/*` folders.
- **Worktrees** — the engine already opens repositories by path; a worktree list command and a repo-switcher entry are the only additions needed.

## Error handling

Rust errors serialize as `{ code, message }` (`AppError`). Codes (`conflict`, `auth`, `non_fast_forward`, …) let the UI offer recovery actions instead of raw library messages. Toasts surface every failed operation; conflict outcomes are warnings, not errors.
