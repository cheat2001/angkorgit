# Changelog

All notable changes to AngKorGit are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed
- **Bitbucket accounts now use API tokens**: Bitbucket Cloud removed app
  passwords on 2026-07-28, so the Accounts tab pointed at a dead page and asked
  for a credential that no longer exists. The "create a token" link now opens the
  Atlassian API token page, the hint names the required
  `read:repository:bitbucket` + `write:repository:bitbucket` scopes, and the
  username field asks for the Atlassian account email
- **Connecting an account verifies the token instead of always claiming success**:
  every account row showed a green tick whether or not anything had been checked,
  and Bitbucket/other hosts saved any typed string as valid. Tokens are now
  verified against the provider before saving where the provider supports it, the
  tick appears only for verified accounts, and unverified ones are labelled as
  such. Bitbucket verification also detects the real Bitbucket username from the
  Atlassian email, so the stored username is the one git actually needs
- **Plan-limit and permission push failures are explained**: HTTP 402 and 403
  from a remote surfaced as raw libgit2 text (`unexpected http status code: 402;
  class=Http (34)`). They now carry a plain description and the error codes
  `plan_limit` / `forbidden`
- **Clone dialog describes authentication accurately**: it credited only the SSH
  agent and credential helper, never mentioning saved accounts — the first
  credential source the engine tries

## [0.2.0] — 2026-08-09

### Fixed
- **AI explanations no longer stick to the wrong commit**: selecting a
  different commit (or conflict file) clears the previous "Explain with AI"
  result instead of showing it under the new selection; an in-flight
  explanation can no longer land on a commit you've already navigated away from
- **AI explanation panels no longer clip long lines**: unbreakable tokens
  (long paths, URLs) in "Explain with AI" output and commit bodies now wrap
  instead of overflowing the inspector/conflict panels, and the assistant is
  instructed to answer in plain text (no raw markdown syntax on screen)
- **Commit message drafts no longer leak between repositories**: the draft (and
  the amend checkbox) was plain component state, so switching tabs/repos showed
  one project's unfinished message in another project's commit box. Drafts are
  now stored per repository path — each repo keeps its own draft, drafts survive
  app restarts, and committing clears only that repo's draft.

### Added
- **Customizable commit message style**: Settings → AI Assistant now has a
  "Commit message style" section — pick Conventional commits, Plain summary, or
  describe your own convention in plain words. Branch prefix rules
  (`staging → [support]`, `feature/* → [{suffix}]`, tokens `{branch}`,
  `{suffix}`, `{ticket}`; first match wins) are enforced by AngKorGit itself
  after generation, so the prefix always holds even if the model ignores it. A
  live preview shows what the current branch would produce. The style config is
  structured per capability so future AI features (e.g. code review) can carry
  their own conventions.
- **AI features without an API key — use the AI CLI you already have**: a new
  "Installed AI CLI" provider in Settings → AI Assistant detects Claude Code,
  Codex CLI, Gemini CLI, OpenCode and Antigravity CLI (`agy`, model overrides
  like `gemini-3.1-pro-high`) on your machine and runs them locally for
  commit messages, diff explanations, conflict help and reviews. Requests go
  through the CLI's own login and quota — AngKorGit stores no key and sends
  nothing anywhere itself. Each request is a one-shot prompt executed in a
  neutral directory (Codex runs sandboxed read-only), with a timeout and
  ANSI-clean output parsing; an optional model override passes through to the
  CLI. Detection survives Finder-launched sessions (GUI apps don't inherit the
  shell PATH) via well-known install locations plus a login-shell fallback.

## [0.1.3] — 2026-08-09

### Fixed
- **Filtered graph no longer explodes lanes**: searching commits or filtering
  by author renders a clean flat results list — one aligned avatar column with
  ref badges inline — instead of dots drifting endlessly to the right over the
  commit messages (parents outside the filter used to open a new lane per
  commit that was never freed)
- **Commit dots can no longer paint over message text**: the graph gutter
  clips its contents and pins the node inside the visible area even on very
  wide graphs
- **First-lane avatars were clipped on their left edge**: the lane origin now
  leaves room for the full avatar circle
- **Relative times no longer wrap to two lines**: the time column fits the
  widest value ("11mo ago") on a single line
- **Website**: docs pages now emit their own meta description and a correct
  per-page canonical URL (previously every page canonicalized to the
  homepage); footer "Contributing" link no longer 404s; docs titles are
  sentence-cased

### Changed
- **Large diffs scroll smoothly** (huge SQL/data files): word-level diff
  degrades gracefully on very long line pairs instead of building an O(m×n)
  token table, syntax highlighting skips extremely long lines and caches
  per-line results, fewer offscreen rows are rendered, and diffs over 3000
  lines stay on the virtualized no-wrap path (the wrap toggle disables itself
  with an explanatory hint)
- **Website install section** reads the latest release version from GitHub at
  build time and the site redeploys automatically when a release is published
  — no more hardcoded version drifting stale

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
