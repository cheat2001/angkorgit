# Roadmap

Updated for v0.15.0 (September 2026). [CHANGELOG.md](../CHANGELOG.md) is the
authoritative record of what shipped in each release; this file tracks
direction.

## Shipped (0.1.0 → 0.15.0)

- [x] Repository: open, clone (with progress), recents, search, repository tabs (drag to reorder)
- [x] Commit: stage files, hunks, and individual lines; unstage, commit, amend; per-repo commit drafts; multi-select in the working copy with bulk stage/unstage/stash/discard; discard for staged files; path filter over changed files and commit files
- [x] History: virtualized animated graph, find in graph by message, hash or author with an n of m stepper (the lanes never collapse), branch filter, refs/tags/HEAD/merges, file history with a one-click jump to the whole commit
- [x] Branch: create, delete, rename, checkout (incl. remote), merge, rebase (+continue/abort), interactive rebase (reorder/reword/squash/fixup/drop), cherry-pick (single or multi-commit, optional "(cherry picked from commit …)" reference), reset (soft/mixed/hard) — explicit merges always record a merge commit; abort merge from the commit box
- [x] Remote: fetch, pull, push, force push, push a branch straight from its tip commit's menu, push/fetch tags, background auto fetch
- [x] Conflicts: visual resolver — aligned A/B panes with line numbers, one take-all checkbox per side (mixed while partly picked) plus hover-to-pick lines that land in file order, a Result pane with in-place editing and its own line numbers behind a draggable split, keyboard control (↑/↓, A/B, ⌘⏎), conflict and file navigation that opens the next conflicted file after each save, guards against losing picks and hand edits, AI explanations
- [x] Worktrees: sidebar section with branch/dirty/missing state, open any worktree as its own tab, create from a branch or commit into a sibling folder, safe remove and prune, branches held elsewhere marked in the sidebar and graph
- [x] Stash: create (whole tree or chosen files), apply, pop (one click from the toolbar), drop; stashes as rows in the graph with their own node and menu; apply single files from a stash · Tags: create (annotated/lightweight), delete, checkout · Submodules: list & update
- [x] Built-in PTY terminal at repo root; built-in file editor
- [x] Diff: inline & side-by-side, syntax highlight, word diff, image diff, find in diff (⌘F), minimap, previous/next change and file navigation (N/P, [/]), opens directly at the first change (no scroll animation), reloads live as the file changes on disk, file history one click from the header; → / ↑ ↓ / ← walk from the graph into a commit's files and back
- [x] Settings: sixteen themes (Angkor Dusk default) with accents & zoom, identity profiles (repo-local) with linked accounts, SSH key management & generation, hosting accounts with verified tokens (Secret Service on Linux, missing tokens flagged), AI providers & commit style, keyboard reference
- [x] Sidebar: accordion sections with pinned headers and collapse-all, row menus on hover and right-click everywhere, empty-state cards; graph display options and column headers; welcome page with keyboard navigation and missing-folder detection
- [x] AI: provider-agnostic (OpenAI, Anthropic, Gemini, Ollama, LM Studio) plus installed AI CLIs (Claude Code, GitHub Copilot CLI, Codex, Gemini CLI, OpenCode, Antigravity) — commit messages, diff/conflict explanations, PR descriptions, staged-change review with team conventions (global + per-repo `.angkorgit/review.md`), background execution with stop, full-size reading views
- [x] Undo/redo for recent operations; drag-and-drop merge/rebase
- [x] Auto-update: pull-based from GitHub releases, signature-verified
- [x] Commit signing: SSH and GPG, driven by existing git config (commit.gpgSign, gpg.format, user.signingKey) — covers commit, amend, merge
- [x] Pull requests: sidebar list, checkout and in-app create with reviewer selection for GitHub, GitLab (incl. self-hosted) and Bitbucket Cloud, through the connected account; browser fallback without one
- [x] Graph search: message text, a hash or prefix, and author all find matches in the full graph, centered and highlighted, with an n of m control; ⌘F focuses the search
- [x] Command line: `angkorgit` / `akg` installed from Settings — open the current folder, a path, or clone by URL or owner/repo into the app
- [x] Blame: a pane of file history with a Working copy row, per-hunk authors, jump to the commit, blame at or before any commit
- [x] External editor: detected editors (VS Code, Cursor, Zed, Sublime, JetBrains, Xcode, GNOME Builder…) from the toolbar, palette and file menus
- [x] Pull with rebase following `pull.rebase`, a merge/rebase choice per pull, and a status bar note of the last fetch
- [x] Fork workflow: "Fast-forward current to this" in the branch menus (enabled only when the branch is strictly behind), every remote fetched on each tab switch, "Open in browser" on a remote and from the palette
- [x] Provider avatars from the connected account when Gravatar has none; the AI provider and its last connection test in the status bar
- [x] Upstream workflow: add a remote from the sidebar, pull requests from a fork into its upstream (GitHub, GitLab, Bitbucket Cloud), a remembered clone folder, a right-click menu in the terminal
- [x] Windows: SSH remotes with ed25519 and ECDSA host keys (libssh2 built on OpenSSL)
- [x] Performance: fast startup (splash waits for the app, not a timer; heavy views load on first use), a quiet file watcher, on-demand commit diffs, loading overlay on slow repository switches

## Next

- [ ] Worktrees: start an installed AI CLI inside a worktree from its row, a per-repo post-create setup command, merged badge with one-step cleanup

## Later — Connected (architecture in place, see Architecture.md)

- [ ] Azure DevOps and Bitbucket Server adapters (GitHub, GitLab and Bitbucket Cloud are in)
- [ ] Read-only pull request detail view (commits, CI status, review state)
- [ ] Issue viewer

## Later — Power

- [ ] Plugin host (palette commands, sidebar sections, inspector tabs)
- [ ] Multi-repo workspaces
- [ ] Performance: commit-graph file support for instant cold opens

Non-goals: enterprise admin tooling, built-in CI dashboards, in-app code review (commenting, approving and merging live on the forge's web UI, one click away), anything else that duplicates a forge's web UI without daily value.
