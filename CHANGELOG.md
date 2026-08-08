# Changelog

All notable changes to AngKorGit are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- **Marketing website** (`apps/website`, Astro 5): hero, features, screenshot
  gallery, performance, AI, install, and open-source sections with dark/light
  themes — deployed to GitHub Pages at `https://angkorgit.app/` (custom domain,
  root base path) with SEO meta, Open Graph, sitemap, and JSON-LD
  `SoftwareApplication` structured data
- **Docs on the website**: repo `docs/*.md` now render on-site at
  `https://angkorgit.app/docs/` (sidebar navigation, breadcrumbs, sitemap) —
  no more tab-switching to GitHub; the GitHub repo stays for source/releases
- **One-line terminal installs** on the website: copy-button quick-install
  commands per OS (dmg with `xattr -cr`, NSIS exe, AppImage)
- **Getting Started guide** (`docs/Getting-Started.md`): first-launch steps
  per platform, now linked from the website install section

### Fixed
- **OG image clipped at the right edge**: headline reduced to fit the 1200px
  canvas, and the `og:image` URL is cache-busted (`?v=3`) so messaging apps
  (Telegram/Slack) refetch the corrected preview

## [0.1.2] — 2026-08-05

### Added
- **Find in diff**: ⌘F over any diff (center panel and file history) — live
  match count, Enter/⇧Enter navigation with wraparound, case toggle,
  pixel-perfect highlights measured from the rendered text, and the view
  scrolls **both vertically and horizontally** to each match
- **12 popular editor themes**: VS Code Dark+/Light+, GitHub Dark/Light,
  One Dark Pro, Tokyo Night, Catppuccin Mocha/Latte, Dracula, Nord,
  Ayu Dark/Light — full surface + syntax palettes, picked from a swatch grid
  in Settings; the accent color works on every theme
- **Folder tree everywhere**: a persisted List/Tree toggle for the working
  copy *and* commit file lists — collapsible folders with counts, deep
  single-child chains compressed into one row
- **Stash previews**: click a stash in the sidebar to see its message,
  author, and full file diffs before applying
- **Commit graph keyboard navigation**: ↑/↓ walk commits, Home/End jump to
  newest/oldest, selection auto-scrolls
- **Copy from diffs**: right-click offers Copy (selected text) and Copy line
  in every diff — commit and file-history diffs included
- **Diffs feel like a read-only editor**: click a pane to place a blinking
  caret, then ⌘A selects just that side (old or new) and ⌘C copies its full
  text — every line, correctly formatted, straight from the diff data.
  "Select all" also sits in the right-click menu
- **The living graph**: author avatars are the commit nodes (merges stay
  dots), and a BRANCH/TAG rail docks one pill per branch beside the graph —
  laptop/cloud icons for local/origin presence, ✓ on the checked-out branch,
  lane-colored connectors, hover to expand long names. Double-click a pill
  to checkout; right-click for checkout/merge/rebase/pull/push/copy

### Changed
- Working copy reordered: **Changes on top, Staged at the bottom** next to
  the commit box — staging moves files toward the commit
- Duplicate diff-view toggles removed from the inspector header

## [0.1.1] — 2026-08-04

### Added
- **Repository tabs**: a GitKraken-style strip above the toolbar — one tab per
  open project, click to switch, ✕/middle-click to close, ＋ to open another;
  tabs persist across restarts
- **Submodules, first-class**: right-click a submodule → **Open as repository**
  (full graph, history — double-click works too), **Update** (init + checkout
  the recorded commit, now authenticated through the full credential chain so
  private hosts work), Copy path
- **Remote management**: right-click a remote → Fetch, **Edit remote…**
  (rename + URL), **Remove remote…** (confirmed; the server is untouched)
- **Status bar**: current branch, commits to push/pull, working-copy state,
  a zoom picker (50–200%), and the app version doubling as a
  check-for-updates button
- **Minimap scrubbing**: drag the diff overview rail to scroll, like a
  scrollbar thumb

### Fixed
- Opening file history while a diff preview was open showed nothing until the
  diff was closed — it now takes over the center area
- Sidebar remote entries no longer wrap the raw URL (name + tooltip instead)
- Zoom honors exact levels (50–200%) instead of clamping to 60–160% and
  rounding to the nearest 10%

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

[Unreleased]: https://github.com/cheat2001/angkorgit/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/cheat2001/angkorgit/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/cheat2001/angkorgit/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/cheat2001/angkorgit/releases/tag/v0.1.0
