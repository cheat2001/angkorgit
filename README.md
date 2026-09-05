<p align="center">
  <img src="apps/desktop/src-tauri/icons/icon.png" width="96" alt="AngKorGit" />
</p>

<h1 align="center">AngKorGit</h1>

<p align="center">
  A native Git client for everyday work. macOS, Windows and Linux.
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
  <img src="docs/assets/demo.gif" alt="Opening a repository, browsing the commit graph, jumping to a diff and resolving a merge conflict" width="920" />
</p>

I use Git all day and every client I tried felt like a website wearing a coat. Slow to open, heavy on disk, a login screen before the first commit. So I wrote one. The engine is libgit2 through Rust, the window is the webview your OS already ships, and the rule for what gets in is simple: the things you do every day, done properly, and not much else.

It's free, MIT licensed, and there is no account, no telemetry and no cloud. Everything on this page is on [angkorgit.app](https://angkorgit.app/) as well.

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/graph.png" />
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/graph-light.png" />
    <img src="docs/assets/graph.png" alt="The commit graph in the Angkor Dusk theme, with branches, working copy and staged changes" width="920" />
  </picture>
</p>

## What it does

**The graph.** Virtualized, so a hundred thousand commits scroll like fifty. Drag a branch onto another to merge or rebase, and a merge from the app is always a real merge commit. Ref chips show the whole name or fold behind a count. Paste a hash into the search and it jumps there. ⌘Z undoes the merge if you picked the wrong branch.

**Conflicts you can read.** Both sides in one view with line numbers on each. One checkbox takes a whole side, a plus on hover takes one line, and the result pane is an editor you can type into. Nothing touches the file until you press Mark resolved.

**Worktrees.** A second checkout of the same repository in a sibling folder, for a hotfix or an AI agent while your real work sits untouched. The sidebar lists them, each opens as its own tab, and checking out a branch that is already open in another folder takes you there instead.

**Everything else you reach for.** Stage files, hunks or single lines. Commit with a summary and a description, amend, revert, reset. Interactive rebase, cherry-pick one or many, stash, tags, submodules. Diffs inline or side by side with word level highlighting, a minimap, image diffs and file history. A built-in terminal per repository. Real confirmation dialogs before anything destructive, and undo for the rest.

**Remotes and accounts.** Fetch, pull and push through the same credential chain git uses. SSH keys and access tokens, several accounts on one host, identity profiles stored per repository and never in your global gitconfig. Pull requests from GitHub, GitLab and Bitbucket: list, check out, create, pick reviewers. Commit signing through your existing git config.

**AI, if you want it.** A commit message from the staged diff, a plain explanation of a commit or a conflict, a review of what you are about to commit, a pull request description. It uses the AI CLI you already log into (Claude Code, Codex, Gemini CLI, OpenCode), or an API key, or Ollama on your own machine. Requests go straight from your computer to the provider you chose. Every one of them has a Stop button.

**Keyboard first.** ⌘K opens a palette with every command in the app, shortcuts are printed next to menu items, Escape closes exactly one thing at a time.

<table>
  <tr>
    <td width="50%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/assets/conflict.png" />
        <source media="(prefers-color-scheme: light)" srcset="docs/assets/conflict-light.png" />
        <img src="docs/assets/conflict.png" alt="The conflict resolver with both sides, line numbers and the result pane" />
      </picture>
      <p align="center"><em>Conflicts: both sides, line numbers, the result is an editor</em></p>
    </td>
    <td width="50%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/assets/worktree.png" />
        <source media="(prefers-color-scheme: light)" srcset="docs/assets/worktree-light.png" />
        <img src="docs/assets/worktree.png" alt="The new worktree dialog over the graph" />
      </picture>
      <p align="center"><em>Worktrees: a second checkout in a sibling folder, its own tab</em></p>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/assets/diff.png" />
        <source media="(prefers-color-scheme: light)" srcset="docs/assets/diff-light.png" />
        <img src="docs/assets/diff.png" alt="A diff with word level highlights, per-hunk staging and the minimap" />
      </picture>
      <p align="center"><em>Diffs with word level highlights, hunk staging and a minimap</em></p>
    </td>
    <td width="50%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/assets/command-palette.png" />
        <source media="(prefers-color-scheme: light)" srcset="docs/assets/command-palette-light.png" />
        <img src="docs/assets/command-palette.png" alt="The command palette" />
      </picture>
      <p align="center"><em>⌘K, then type</em></p>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/assets/theme-setting.png" />
        <source media="(prefers-color-scheme: light)" srcset="docs/assets/theme-setting-light.png" />
        <img src="docs/assets/theme-setting.png" alt="Appearance settings" />
      </picture>
      <p align="center"><em>Sixteen themes, five accents, UI zoom</em></p>
    </td>
    <td width="50%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/assets/ai-config-setting.png" />
        <source media="(prefers-color-scheme: light)" srcset="docs/assets/ai-config-setting-light.png" />
        <img src="docs/assets/ai-config-setting.png" alt="AI settings" />
      </picture>
      <p align="center"><em>AI settings. Your own provider, or a CLI you already have</em></p>
    </td>
  </tr>
</table>

## What I left out, on purpose

- In-app pull request review. The forge does this better, with CI logs and suggestions. There is an Open in browser button.
- Telemetry, accounts, a cloud. Nothing phones home and there is nothing to sign up for.
- A blame view. File history is there, line level blame is on the list.
- A plugin marketplace. Not yet.

## Install

Grab the file for your platform from the [releases page](https://github.com/cheat2001/angkorgit/releases), or use the terminal. The commands below are pinned to the current release, so bump the version if a newer one is out.

```bash
# macOS with Homebrew (also clears the Gatekeeper flag for you)
brew install --cask cheat2001/tap/angkorgit

# macOS, direct download
curl -L https://github.com/cheat2001/angkorgit/releases/download/v0.10.0/AngKorGit_0.10.0_universal.dmg -o ~/Downloads/AngKorGit.dmg && xattr -cr ~/Downloads/AngKorGit.dmg && open ~/Downloads/AngKorGit.dmg

# Windows (PowerShell)
curl -L https://github.com/cheat2001/angkorgit/releases/download/v0.10.0/AngKorGit_0.10.0_x64-setup.exe -o "$env:TEMP\AngKorGit-setup.exe"; Start-Process "$env:TEMP\AngKorGit-setup.exe"

# Linux (AppImage)
curl -L https://github.com/cheat2001/angkorgit/releases/download/v0.10.0/AngKorGit_0.10.0_amd64.AppImage -o ~/Downloads/AngKorGit.AppImage && chmod +x ~/Downloads/AngKorGit.AppImage && ~/Downloads/AngKorGit.AppImage
```

The builds aren't signed with a paid certificate, so your OS asks once on first launch. After that the app updates itself, and every update is verified with a signature before it installs. All releases are built in public by GitHub Actions from this source tree. The full first-launch walkthrough is on the [getting started page](https://angkorgit.app/docs/getting-started/).

### macOS, first launch

1. Open the `.dmg` and drag AngKorGit into Applications. Don't run it from inside the dmg window, macOS would start it from a temporary location where permissions can't be saved.
2. Launch it. macOS says the app cannot be opened. Close that, go to System Settings, Privacy & Security, scroll down and click Open Anyway. This happens once.
3. The first time you open a repository in Desktop, Documents or Downloads, macOS asks for access to that folder. Allow, once per folder.
4. If you connect a GitHub or GitLab account, the first git operation per session asks to read the token from your Keychain. Plain Allow is enough, Always Allow has no effect on unsigned apps.

If a permission dialog ever loops, reset the stale records and try again:

```sh
tccutil reset All dev.angkorgit.app
```

### Windows and Linux

Windows: SmartScreen says the publisher is unknown. More info, then Run anyway. An `.msi` is on the releases page too.

Linux: `chmod +x` the AppImage and run it, or install the `.deb` or `.rpm`. Needs WebKitGTK 4.1 and libssl, which most desktops already have.

## Building from source

You need [Node 20+](https://nodejs.org), [pnpm 10+](https://pnpm.io), [Rust stable](https://rustup.rs) and the [Tauri v2 system dependencies](https://v2.tauri.app/start/prerequisites/).

```bash
pnpm install
pnpm icons          # generate placeholder app icons
pnpm tauri:dev      # run the desktop app
```

The UI runs in a plain browser on a demo dataset, no Rust toolchain needed:

```bash
pnpm dev            # http://localhost:1420
```

The website lives in `apps/website` (Astro, static, GitHub Pages):

```bash
pnpm website            # http://localhost:4321/
pnpm website:images     # regenerate WebP screenshots and og.png
pnpm website:build      # static build in apps/website/dist
```

Tests:

```bash
pnpm test           # unit tests
pnpm test:e2e       # Playwright, against demo mode
cd apps/desktop/src-tauri && cargo test   # git engine integration tests on real temp repos
```

## Repository layout

| Path | Contents |
| --- | --- |
| `apps/desktop` | The Tauri v2 desktop app, React frontend and Rust engine |
| `apps/website` | The website (Astro, static), live at [angkorgit.app](https://angkorgit.app/), docs rendered on site |
| `packages/core` | Domain types, graph layout, word diff, conflict parsing, forge and AI adapters |
| `packages/design-system` | Design tokens, Tailwind preset, UI primitives, logo |
| `docs` | Architecture, UI guidelines, development, contributing, distribution, roadmap, coding standards |
| `tests` | Unit and e2e tests |
| `scripts` | Icon generation and tooling |

More in [docs/Architecture.md](docs/Architecture.md) and [docs/Development.md](docs/Development.md). Bugs and ideas go in [issues](https://github.com/cheat2001/angkorgit/issues), I read them all.

## License

MIT
