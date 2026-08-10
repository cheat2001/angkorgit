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
  <a href="https://angkorgit.app/"><img alt="Website" src="https://img.shields.io/badge/website-angkorgit.app-8B5CF6.svg" /></a>
</p>

---

<p align="center">
  <img src="docs/assets/graph.png" alt="AngKorGit — commit graph with repository tabs and the ⌘K command palette" width="920" />
</p>

AngKorGit focuses on the Git operations developers use every day and executes them exceptionally well — in an app that weighs **12 MB to download** (25 MB installed, universal macOS build) instead of a gigabyte.

<table>
  <tr>
    <td width="50%">
      <img src="docs/assets/diff.png" alt="Side-by-side diff with commit details" />
      <p align="center"><em>Side-by-side diffs — word-level highlights, minimap, line-level staging</em></p>
    </td>
    <td width="50%">
      <img src="docs/assets/command-palette.png" alt="⌘K command palette" />
      <p align="center"><em>The ⌘K command palette — every action searchable, keyboard-first by design</em></p>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <img src="docs/assets/theme-setting.png" alt="Appearance settings — themes and accent colors" />
      <p align="center"><em>Dark and light themes, five accent colors, and UI zoom — all in one settings tab</em></p>
    </td>
    <td width="50%">
      <img src="docs/assets/ai-config-setting.png" alt="AI settings" />
      <p align="center"><em>AI settings — connect any provider; keys stay in your OS keychain</em></p>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <img src="docs/assets/shortcut-key.png" alt="Keyboard shortcuts overview" />
      <p align="center"><em>Shortcuts render next to every action and can be fully customized</em></p>
    </td>
    <td width="50%">
      <img src="docs/assets/welcome.png" alt="Welcome screen" />
      <p align="center"><em>Open, clone, or return to recent projects</em></p>
    </td>
  </tr>
</table>

## Highlights

- **Fast by architecture** — Rust + libgit2 engine, virtualized graph *and* diff rendering, incremental history loading. 100k-commit repositories and multi-thousand-line diffs stay at full frame rate.
- **The full daily toolkit** — stage down to individual hunks, commit/amend, branch folders with right-click menus, merge/rebase/cherry-pick/revert/reset, stash, tags, submodule awareness, per-branch push & pull (fast-forward without checkout), and **drag a branch onto another to merge** — every operation undoable with ⌘Z.
- **Review with intent** — full-width diffs with a clickable minimap, previous/next-change hops, side-by-side or inline, word-level highlighting, whole-file view, image diffs.
- **Visual conflict resolution** — checkbox picks per side, conflict-to-conflict navigation, and a fully **editable result pane** with marker guards.
- **Always in sync** — a filesystem watcher keeps the WIP row, status, and graph in sync while you edit in your IDE or commit from a terminal.
- **Multi-account, multi-identity** — per-host tokens in the OS keychain (GitHub, GitLab incl. self-hosted, Bitbucket) and per-repo committer profiles, so work and personal never mix. `https://` remotes use those accounts; `git@` remotes use SSH keys — **note that SSH keys must currently be RSA** ([why](docs/Getting-Started.md#ssh-keys)).
- **Keyboard-first** — ⌘K palette for everything, ⌘Z/⌘⇧Z undo/redo, ⌘B sidebar, ⌘± zoom.
- **Beginner-friendly and safe** — destructive actions get real confirmation dialogs, failures explain themselves (down to "this is a submodule — open it as its own repository").
- **Dark by default**, light theme included. Temple Gold `#D97706` accents, Inter + JetBrains Mono, 8px spacing rhythm.
- **Context-aware AI** — commit messages, diff/conflict explanations, PR descriptions, staged-change review. Any provider: OpenAI, Anthropic, Gemini, Ollama, LM Studio — local models welcome.

## Install

Download the latest release for your platform from the
[releases page](https://github.com/cheat2001/angkorgit/releases), or install
from the terminal (pinned to the current release — bump the version number
when a newer release lands):

```bash
# macOS (downloads, removes the Gatekeeper quarantine flag, opens the dmg)
curl -L https://github.com/cheat2001/angkorgit/releases/download/v0.3.0/AngKorGit_0.3.0_universal.dmg -o ~/Downloads/AngKorGit.dmg && xattr -cr ~/Downloads/AngKorGit.dmg && open ~/Downloads/AngKorGit.dmg

# Windows (PowerShell)
curl -L https://github.com/cheat2001/angkorgit/releases/download/v0.3.0/AngKorGit_0.3.0_x64-setup.exe -o "$env:TEMP\AngKorGit-setup.exe"; Start-Process "$env:TEMP\AngKorGit-setup.exe"

# Linux (AppImage)
curl -L https://github.com/cheat2001/angkorgit/releases/download/v0.3.0/AngKorGit_0.3.0_amd64.AppImage -o ~/Downloads/AngKorGit.AppImage && chmod +x ~/Downloads/AngKorGit.AppImage && ~/Downloads/AngKorGit.AppImage
```

AngKorGit is free, open-source software and is **not signed with a paid
certificate**, so your OS asks for a few extra confirmations on first launch.
Full first-launch walkthroughs are on the
[Getting Started guide](https://angkorgit.app/docs/getting-started/).

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

The marketing site lives in `apps/website` (Astro, static, GitHub Pages):

```bash
pnpm website            # http://localhost:4321/
pnpm website:images     # regenerate WebP screenshots + og.png
pnpm website:build      # static build → apps/website/dist
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
| `apps/website` | The marketing site (Astro, static) — live at [angkorgit.app](https://angkorgit.app/), docs rendered on-site |
| `packages/core` | Domain types, graph layout, word diff, conflict parsing, AI module |
| `packages/design-system` | Design tokens, Tailwind preset, UI primitives, logo |
| `docs` | Architecture, UI guidelines, roadmap, coding standards |
| `tests` | Unit + e2e tests |
| `scripts` | Icon generation and tooling |

Read more in [docs/Architecture.md](docs/Architecture.md) and [docs/Development.md](docs/Development.md).

## License

MIT