# Changelog

All notable changes to AngKorGit are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.1] — 2026-08-04

### Added
- **Repository tabs**: a GitKraken-style strip above the toolbar — one tab per
  open project, click to switch, ✕/middle-click to close, ＋ to open another;
  tabs persist across restarts
- **Submodules, first-class**: right-click a submodule → **Open as repository**
  (full graph, history — double-click works too), **Update** (init + checkout
  the recorded commit, now authenticated through the full credential chain so
  private hosts work), Copy path

### Fixed
- Opening file history while a diff preview was open showed nothing until the
  diff was closed — it now takes over the center area
- Sidebar remote entries no longer wrap the raw URL (name + tooltip instead)

## [0.1.0] — 2026-08-04

The first release. 🏛️

### Repository & history
- Open, clone (with progress), init, and search recent repositories; instant repo switcher
- Virtualized commit graph (100k-commit repositories stay smooth) with search,
  author and branch filters, ref/tag/HEAD decorations, and merge topology
- **WIP row** pinned above the graph whenever the working tree has changes
- Live filesystem watcher — external edits and terminal commits appear within ~½s

### Committing & review
- Stage/unstage files, **individual hunks, and individual lines** (right-click
  a line in any diff view mode); discard file/line/all with verified outcomes
  (submodule-aware explanations, pair-aware line restore)
- Auto-growing commit box with 50/72 summary counter; hidden when the tree is clean
- Full-width diff view with **minimap**, previous/next-change navigation,
  inline & side-by-side, word-level diff, whole-file mode, image diffs —
  virtualized for any file size, editor-grade smooth scrolling and panning
- **File history**: ⌘K → "File history…" (or right-click a file) — docked
  commit list showing who changed the file and when, one-click diff switching,
  side panels auto-collapse for a full-width review
- **Built-in file editor**: right-click → Edit file, ⌘S saves in place

### Branching & operations
- Branch **folder tree** with right-click context menu: checkout, merge, rebase,
  **pull/push per branch** (fast-forward without checkout), create branch here,
  rename, delete
- **Drag a branch onto another** to merge or rebase
- Cherry-pick, revert (conflict-safe, merge-aware), reset (soft/mixed/hard)
- **Undo/redo (⌘Z/⌘⇧Z)** for commits, checkouts, merges, rebases, cherry-picks,
  resets, reverts and branch operations — with repo-moved and dirty-tree guards

### Conflicts
- Visual resolver: checkbox per side (keep both!), conflict-to-conflict
  navigation, and a fully **editable result pane** with marker guards

### Accounts & identity
- Multi-provider **hosting accounts** (GitHub, GitLab.com, self-hosted GitLab,
  Bitbucket) — tokens in the OS keychain, matched to remotes by host
- **Identity profiles** (work/personal) applied per-repository — immune to other
  tools rewriting the global gitconfig

### Experience
- ⌘K command palette, built-in PTY terminal, resizable panels, collapsible sidebar
- Dark/light themes + **5 accent colors**; UI zoom (⌘±); Gravatar author avatars
- Product-grade Settings window (navigation rail, titled sections)
- AI assistant with pluggable providers (OpenAI, Anthropic, Gemini, Ollama,
  LM Studio): commit messages, diff/conflict explanations, PR descriptions, reviews

[Unreleased]: https://github.com/cheat2001/angkorgit/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/cheat2001/angkorgit/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/cheat2001/angkorgit/releases/tag/v0.1.0
