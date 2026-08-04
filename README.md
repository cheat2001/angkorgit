<p align="center">
  <img src="apps/desktop/src-tauri/icons/icon.png" width="96" alt="AngKorGit" />
</p>

<h1 align="center">AngKorGit</h1>

<p align="center">
  A modern, fast, beautiful cross-platform Git client.<br/>
  Inspired by Angkor Wat — strength, simplicity, and craftsmanship from Cambodia. 🇰🇭
</p>

<p align="center">
  <a href="https://github.com/cheat2001/angkorgit/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/cheat2001/angkorgit/actions/workflows/ci.yml/badge.svg" /></a>
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-D97706.svg" /></a>
  <img alt="Platforms" src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-374151.svg" />
  <img alt="Built with Tauri" src="https://img.shields.io/badge/built%20with-Tauri%20v2%20%2B%20Rust-D97706.svg" />
</p>

---

AngKorGit focuses on the Git operations developers actually use every day and executes them exceptionally well — in an app that weighs **~8 MB** instead of a gigabyte.

## Highlights

- **Fast by architecture** — Rust + libgit2 engine, virtualized graph *and* diff rendering, incremental history loading. 100k-commit repositories and multi-thousand-line diffs stay at full frame rate.
- **The full daily toolkit** — stage down to individual hunks, commit/amend, branch folders with right-click menus, merge/rebase/cherry-pick/revert/reset, stash, tags, submodule awareness, per-branch push & pull (fast-forward without checkout), and **drag a branch onto another to merge** — every operation undoable with ⌘Z.
- **Review like you mean it** — full-width diffs with a clickable minimap, previous/next-change hops, side-by-side or inline, word-level highlighting, whole-file view, image diffs.
- **Conflicts without fear** — checkbox picks per side (keep both!), conflict-to-conflict navigation, and a fully **editable result pane** with marker guards.
- **Live by default** — a filesystem watcher keeps the WIP row, status, and graph in sync while you edit in your IDE or commit from a terminal.
- **Multi-account, multi-identity** — per-host tokens in the OS keychain (GitHub, GitLab incl. self-hosted, Bitbucket) and per-repo committer profiles, so work and personal never mix.
- **Keyboard-first** — ⌘K palette for everything, ⌘Z/⌘⇧Z undo/redo, ⌘B sidebar, ⌘± zoom.
- **Beginner-friendly & safe** — destructive actions get real confirmation dialogs, failures explain themselves (down to "this is a submodule — open it as its own repository").
- **Dark by default**, light theme included. Temple Gold `#D97706` accents, Inter + JetBrains Mono, 8px spacing rhythm.
- **AI where it helps** — commit messages, diff/conflict explanations, PR descriptions, staged-change review. Any provider: OpenAI, Anthropic, Gemini, Ollama, LM Studio. Nothing hardcoded, local models welcome.

## Getting started

Prerequisites: [Node 20+](https://nodejs.org), [pnpm 9+](https://pnpm.io), [Rust stable](https://rustup.rs) and the [Tauri v2 system deps](https://v2.tauri.app/start/prerequisites/).

```bash
pnpm install
pnpm icons          # generate placeholder app icons
pnpm tauri:dev      # run the desktop app
```

Browser-only UI development (no Rust toolchain needed — runs on a demo dataset):

```bash
pnpm dev            # http://localhost:1420
```

Tests:

```bash
pnpm test           # unit tests (graph layout, word diff, conflict parser)
pnpm test:e2e       # Playwright, against demo mode
cd apps/desktop/src-tauri && cargo test   # git engine integration tests
```

## Repository layout

| Path | Contents |
| --- | --- |
| `apps/desktop` | The Tauri v2 desktop app (React frontend + Rust engine) |
| `packages/core` | Domain types, graph layout, word diff, conflict parsing, AI module |
| `packages/design-system` | Design tokens, Tailwind preset, UI primitives, logo |
| `docs` | Architecture, UI guidelines, roadmap, coding standards |
| `tests` | Unit + e2e tests |
| `scripts` | Icon generation and tooling |

Read more in [docs/Architecture.md](docs/Architecture.md) and [docs/Development.md](docs/Development.md).

## License

MIT
Nice