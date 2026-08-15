# Changelog

All notable changes to AngKorGit are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- **Terminal sessions persist per repository** — switching to another repo tab
  and back reattaches the same shell with its scrollback and any running
  command intact. A session ends only when its repo tab is closed, the shell
  exits, or the app quits
- **File history covers the file's whole lifetime** — it loads 500 changes at
  a time with a "Show older changes" button instead of stopping at the 200
  most recent

### Fixed
- The conflict resolver no longer corrupts files whose content contains lines of
  8 or more marker characters (`========` dividers, setext/RST underlines) —
  markers are now matched at exactly 7 characters, and unresolved conflicts
  round-trip byte-for-byte, preserving diff3 base labels, CRLF line endings, and
  bare markers
- Switching repositories while a slow refresh or history load was still in
  flight could flip the app back to the previous repository, show one repo's
  history under another's header, or apply an older filter's results over a
  newer one — every async store action now discards stale responses
- The built-in terminal no longer kills your running shell on every commit,
  fetch, or file change — the session now survives refreshes and is only
  recreated when you switch repositories
- Pasting large input into the terminal (or a paused pager) could freeze the
  entire app — terminal, file, and watcher commands now run off the main thread
- Builds running inside the repository (`pnpm install`, `cargo build`) no
  longer cause a continuous refresh storm — the file watcher now ignores
  gitignored paths; changes arriving during a refresh trigger one trailing
  re-run instead of being dropped
- Merge, cherry-pick, and revert now check your git identity before touching
  the repository, so a missing user.name can no longer strand a repo
  mid-operation
- Force-pushing with tags no longer force-pushes the tags themselves
- Staging a broken symlink now stages it instead of deleting it from the index
- AI commit prefixes keep `$` sequences in branch names literal
- Undoing to an unknown reset mode is now rejected instead of silently
  performing a mixed reset

### Changed
- Large-repo performance: deep history scrolling no longer re-parses every
  skipped commit; the sidebar, working-copy lists, commit graph rows, and
  inspector re-render only when their own data changes; the selected commit's
  diff is no longer re-fetched while scrolling the graph; image diffs are
  capped at 10 MB per side instead of loading unbounded payloads; clone
  progress and AI requests generate less overhead

## [0.4.0] — 2026-08-11

Merging is the theme of this release: it now behaves the way the graph leads
you to expect, and explains itself along the way — dressed in new signature
themes and kept fresh by background fetching.

### Added
- **Angkor Dusk and Angkor Dawn signature themes** — a warm laterite dark and a
  sandstone light, with a kbach-inspired colonnade pattern (Angkor's baluster
  window columns) etched at low opacity into the welcome and splash screens.
  The ornament never appears behind the graph, diffs, or code, is invisible in
  every other theme, and your accent colour still applies on top. **Angkor Dusk
  is the default for new installs**; existing users keep their chosen theme
- **Auto fetch** — the app fetches from your remote in the background (Settings
  → Git, default every minute, also on window focus), so teammates' commits
  appear on the graph by themselves. Failures are silent and back off
- **Repository tabs can be reordered by drag and drop**, and the order is
  remembered
- **A GitKraken-style conflict resolver.** Sides A and B sit in aligned panes
  with a checkbox on every line — take a whole side from the pane header, or
  cherry-pick individual lines. The Output pane below shows the clean merged
  result with no `<<<<<<<`/`>>>>>>>` markers: picked lines carry an A/B tag in
  their side's colour (in the order you picked them) and unresolved sections
  show a clear placeholder. Hand-editing moved behind an explicit pencil
  button, with the same guards as before
- **Commit details show a change-type summary** — "M 72 modified · A 57 added ·
  D 1 deleted" instead of a flat file count, and each file row's icon is tinted
  by its change type, matching the working copy's A/M/D/R colour convention
- **Ahead/behind badges cap at 99+** in the sidebar, toolbar, and status bar —
  a branch 1172 commits ahead no longer stretches its row; hover tooltips keep
  the exact count where one exists
- **The commit box pre-fills git's merge message** ("Merge branch 'x' into y")
  after a conflicted merge, so finishing the merge is one click once conflicts
  are resolved — it never overwrites a message you already typed
- **The drag-and-drop dialog explains each action** — merge (records a merge
  commit), fast-forward (moves the pointer), rebase (replays commits, rewrites
  history) — so the choice is clear without knowing git terminology

### Changed
- **"Already up to date" now shows as an info toast, not a green success** —
  everywhere an operation can report it (merge, pull, fast-forward)
- **Explicit branch merges now always create a merge commit** (like GitKraken).
  Previously, merging a branch whose changes were already contained in the
  source fast-forwarded — the branch pointer moved with no visible
  "Merge branch 'x' into y" commit on the graph, which read as "the merge did
  nothing". Drag-and-drop merge and the "Merge into current" context menus now
  record a real merge commit; the drop dialog offers a fast-forward option —
  shown only when the target is strictly behind, like GitKraken. Pull still
  fast-forwards when it can

### Fixed
- **The graph now updates when only remote refs change.** A fetch that moved
  `origin/…` without touching your checked-out branch used to refresh the file
  status only — new remote commits and behind-badges never appeared until a
  manual reload
- **Graph avatars on the first lane no longer have their coloured ring clipped**
  on the left edge of the graph column
- **Merge and rebase now always target the branch, never a same-named tag.** In
  repositories with a tag named like a branch (deployment tags such as `demo` or
  `production` are common), merging that branch silently resolved to the old
  tagged commit — the merge reported "Already up to date" or merged stale
  content. The graph's branch filter had the same flaw, so sidebar clicks could
  show a tag's old history instead of the branch's. Branch names now resolve to
  `refs/heads/…`, then `refs/remotes/…`, before anything else
- **Fast-forward merges no longer discard uncommitted changes.** The
  fast-forward path used a force checkout, silently wiping local edits; it now
  uses a safe checkout and refuses (with an error) if local changes would be
  overwritten, matching git's own behaviour
- **Drag-and-drop merge/rebase reads the current branch from the repository**,
  not from possibly stale UI state, before deciding whether to check out the
  target branch first

## [0.3.0] — 2026-08-10

Connecting to a remote is the theme of this release. Several controls looked
like they worked and did not; those are fixed or gone.

### Added
- **An SSH card in Settings → Authentication**: toggle the SSH agent, browse for
  a private key instead of typing a path, show and copy the matching public key
  (the thing you paste into GitHub/GitLab/Bitbucket), and generate a new ed25519
  key without leaving the app. Generation always picks a free filename, so an
  existing key can never be overwritten
- **A toggle for the system credential helper**: turn it off to stop AngKorGit
  falling back to credentials saved by git or another client, so a configured
  account can be tested on its own

### Changed
- **Settings → Accounts is now Settings → Authentication**, holding both hosting
  accounts and SSH keys. Which credential applies was the most confusing thing
  about connecting to a remote — the tab now states it plainly (`https://`
  remotes use accounts, `git@` remotes use SSH keys). The Git tab keeps committer
  identity and profiles

### Fixed
- **Bitbucket accounts now use API tokens**: Bitbucket Cloud removed app
  passwords on 2026-07-28, so the tab pointed at a dead page and asked for a
  credential that no longer exists. The link now opens the Atlassian API token
  page, the hint names the required `read:repository:bitbucket` +
  `write:repository:bitbucket` scopes, and the username field asks for the
  Atlassian account email
- **Connecting an account verifies the token instead of always claiming success**:
  every row showed a green tick whether or not anything had been checked, and
  Bitbucket and other hosts saved any typed string as valid. Tokens are verified
  against the provider before saving where the provider supports it, the tick
  appears only for verified accounts, and unverified ones are labelled as such.
  Bitbucket verification also detects the real Bitbucket username from the
  Atlassian email, so the stored username is the one git actually needs
- **The "SSH private key" setting now does something**: present since the first
  commit, its value was never sent to the git engine — only `~/.ssh/id_ed25519`
  and `~/.ssh/id_rsa` were ever tried, so anyone with a differently-named key
  entered a path, saw no error, and still could not authenticate. The configured
  key is now tried ahead of the defaults, `~` is expanded, and each retry advances
  to the next candidate instead of re-offering the first one forever
- **AI provider settings survive switching providers**: model, base URL and API
  key were one shared record, so trying another provider for an hour and
  switching back meant re-entering everything. Each provider keeps its own
  settings now, restored on switch and across restarts. This also stops one
  provider's API key being sent to another
- **"Reduce motion" now reduces motion**: the toggle was stored and never read.
  It now disables the app's movement animations (dialogs, fades, slides, the
  diff caret, Framer Motion) — scoped to exactly those, so enabling it costs
  nothing while scrolling — and it defaults to your OS reduce-motion preference
  on first run
- **Several SSH keys work without the agent**: only the configured key plus
  `~/.ssh/id_ed25519` and `~/.ssh/id_rsa` were ever offered, so a second key
  under any other name was never tried. The other keypairs in `~/.ssh` are now
  offered too, up to five in total (servers refuse after a handful of failed
  attempts). Note that AngKorGit does not read `~/.ssh/config` — `Host` and
  `IdentityFile` rules that work in your terminal do not apply here; use the
  SSH agent for per-host keys
- **OpenCode installed the recommended way is now detected**: the official
  installer puts the binary in `~/.opencode/bin` and adds PATH only to `.zshrc`,
  which neither the well-known-locations scan nor the login-shell fallback could
  see. That directory — plus pnpm's global bin and mise shims — is now scanned
  directly
- **Plan-limit and permission failures are explained**: HTTP 402 and 403 from a
  remote surfaced as raw libgit2 text (`unexpected http status code: 402;
  class=Http (34)`). They now carry a plain description and the error codes
  `plan_limit` / `forbidden`
- **Clone dialog describes authentication accurately**: it credited only the SSH
  agent and credential helper, never mentioning saved accounts — the first
  credential source the engine tries

### Removed
- **Settings that did nothing**: the "Git executable" field claimed to configure
  the built-in terminal but was read by no code (the terminal spawns your shell),
  and an unused `githubUser` value sat in stored settings. Both are gone, along
  with the Advanced card that held them and an unused `repo_discover` IPC command

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

[Unreleased]: https://github.com/cheat2001/angkorgit/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/cheat2001/angkorgit/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/cheat2001/angkorgit/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/cheat2001/angkorgit/compare/v0.1.3...v0.2.0
[0.1.3]: https://github.com/cheat2001/angkorgit/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/cheat2001/angkorgit/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/cheat2001/angkorgit/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/cheat2001/angkorgit/releases/tag/v0.1.0
