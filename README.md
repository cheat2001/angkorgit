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

<p align="center">
  <img src="docs/assets/hero.png" alt="AngKorGit — side-by-side diff view with commit details" width="900" />
</p>

<p align="center">
  <a href="https://github.com/cheat2001/angkorgit/blob/main/docs/assets/angkorgit-demo.mp4"><b>▶ Watch the 45-second demo</b></a>
</p>

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

## Install

Download the latest release for your platform from the
[releases page](https://github.com/cheat2001/angkorgit/releases).

AngKorGit is free, open-source software and is **not signed with a paid
certificate**, so your OS asks for a few extra confirmations on first launch.

### macOS — first launch, step by step

1. Open the `.dmg` and **drag AngKorGit into Applications**. Don't launch it
   from inside the dmg window — macOS would run it from a temporary sandbox
   where permissions can never be saved.
2. Launch it. macOS shows *"AngKorGit" cannot be opened* with **Move to
   Trash** — this only means the app has no paid Apple certificate. Close it,
   then go to **System Settings → Privacy & Security**, scroll down, and click
   **"Open Anyway"** next to the AngKorGit message. Confirm once more. This
   happens only on the very first launch.
3. When you open a repository in Desktop/Documents/Downloads, macOS asks
   *"AngKorGit would like to access files in your … folder"* → **Allow**.
   One prompt per folder, then it's remembered.
4. If you connect a GitHub/GitLab account, the first git operation per app
   session asks to read the token from your Keychain → **Allow** (plain
   "Allow" — "Always Allow" has no effect on unsigned apps).

Expect **2–3 clicks total on first run**, then one folder re-confirmation
after app updates (each unsigned build has a new identity). If a permission
dialog ever loops endlessly, reset the stale records and try again:

```sh
tccutil reset All dev.angkorgit.app
```

### Windows & Linux

| Platform | First launch |
| --- | --- |
| **Windows** | SmartScreen: **More info → Run anyway** |
| **Linux** | AppImage: `chmod +x AngKorGit_*.AppImage`, then run — or install the `.deb` |

After that, AngKorGit **updates itself**: every update is cryptographically
verified (minisign) before installing, and all releases are built in public by
GitHub Actions from this source tree. No telemetry, ever. Prefer to audit?
Build from source below.

## Building from source

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