# Development Guide

## Prerequisites

- Node 20+ and pnpm 10+ (`corepack enable` — the repo pins the exact version via `packageManager`)
- Rust stable via [rustup](https://rustup.rs)
- Tauri v2 system dependencies — see the [official list](https://v2.tauri.app/start/prerequisites/):
  - **macOS**: Xcode command line tools
  - **Linux**: `libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf libssl-dev`
  - **Windows**: WebView2 (preinstalled on Win 11), MSVC build tools

## Everyday commands

| Command | What it does |
| --- | --- |
| `pnpm install` | install all workspace deps |
| `pnpm icons` | generate placeholder app icons (required once before `tauri dev`) |
| `pnpm tauri:dev` | run the full desktop app (Vite + Rust, hot reload both sides) |
| `pnpm dev` | frontend only, in the browser, on the built-in **demo dataset** |
| `pnpm typecheck` | TypeScript across all packages |
| `pnpm test` / `pnpm test:watch` | unit tests (Vitest) |
| `pnpm test:e2e` | Playwright against demo mode |
| `cd apps/desktop/src-tauri && cargo test` | git engine integration tests (real temp repos) |
| `pnpm tauri:build` | production bundles (.dmg/.msi/.deb/.AppImage) |
| `pnpm release:mac` | build, then open the folder containing the .dmg |
| `pnpm install:mac` | copy the built AngKorGit.app into /Applications and launch it |
| `pnpm website` | dev-server the marketing site (http://localhost:4321/) |
| `pnpm website:build` / `pnpm website:preview` | build / preview the static site |
| `pnpm website:images` | regenerate WebP screenshots + og.png from `docs/assets` |

## Demo mode

`src/core/ipc.ts` detects whether it runs inside Tauri. Outside (plain browser), every command is answered by `src/core/demo.ts` — a deterministic 400-commit synthetic repository with branches, merges, a dirty working copy and a conflict sample. Use it for all UI work; it is also what CI's Playwright job tests.

## Working on the Rust engine

The engine lives in `apps/desktop/src-tauri/src/core/`, one module per domain area. Conventions:

- Commands (`commands.rs`) stay thin — parse args, call `core::*`, return serde types.
- Everything blocking goes through the `blocking()` helper (`spawn_blocking`).
- Every operation that can leave the repo mid-state (merge, rebase, cherry-pick) returns an `OpOutcome` with `status: "conflicts"` rather than an error.
- Add integration coverage in `tests/git_engine.rs` for every new engine function — tests create real repositories in a temp dir.

## Adding an AI provider

1. Implement the adapter in `packages/core/src/ai/providers.ts` (one function, ~40 lines).
2. Register it in `createAiProvider` and `AI_PROVIDER_PRESETS`.
3. Done — settings UI, capabilities and transport pick it up automatically.

Installed AI-CLI agents (Claude Code, Codex, Gemini CLI, OpenCode) follow a different
path: add the agent's argv/stdin shape in `packages/core/src/ai/cliAgents.ts` and its
binary to the allowlist in `apps/desktop/src-tauri/src/ai_cli.rs`.

## Release

Tag `v*` and push: `.github/workflows/release.yml` builds macOS (universal), Windows and Linux bundles via `tauri-action` and attaches them to a draft GitHub release.
