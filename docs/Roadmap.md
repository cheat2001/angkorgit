# Roadmap

Updated for v0.4.0 (August 2026). [CHANGELOG.md](../CHANGELOG.md) is the
authoritative record of what shipped in each release; this file tracks
direction.

## Shipped (0.1.0 → 0.4.0)

- [x] Repository: open, clone (with progress), recents, search, repository tabs (drag to reorder)
- [x] Commit: stage files, hunks, and individual lines; unstage, commit, amend; per-repo commit drafts
- [x] History: virtualized animated graph, search, author/branch filters, refs/tags/HEAD/merges, file history
- [x] Branch: create, delete, rename, checkout (incl. remote), merge, rebase (+continue/abort), cherry-pick, reset (soft/mixed/hard) — explicit merges always record a merge commit
- [x] Remote: fetch, pull, push, force push, push/fetch tags, background auto fetch
- [x] Conflicts: visual resolver — aligned A/B panes, per-line checkbox picks, a clean Output pane, guarded hand-editing
- [x] Stash: create, apply, pop, drop · Tags: create (annotated/lightweight), delete, checkout · Submodules: list & update
- [x] Built-in PTY terminal at repo root; built-in file editor
- [x] Diff: inline & side-by-side, syntax highlight, word diff, image diff, find in diff (⌘F), minimap
- [x] Settings: sixteen themes (Angkor Dusk default) with accents & zoom, identity profiles (repo-local), SSH key management & generation, hosting accounts with verified tokens, AI providers & commit style, keyboard reference
- [x] AI: provider-agnostic (OpenAI, Anthropic, Gemini, Ollama, LM Studio) plus installed AI CLIs (Claude Code, Codex, Gemini CLI, OpenCode) — commit messages, diff/conflict explanations, PR descriptions, staged-change review
- [x] Undo/redo for recent operations; drag-and-drop merge/rebase
- [x] Auto-update: pull-based from GitHub releases, signature-verified

## Next

- [ ] Interactive rebase (reorder/squash/reword) UI
- [ ] Blame view
- [ ] GPG/SSH commit signing
- [ ] File-tree view for the working copy; previous/next-file navigation in diffs
- [ ] Provider avatars via connected accounts, layered over Gravatar

## Later — Connected (architecture in place, see Architecture.md)

- [ ] GitHub / GitLab / Azure DevOps / Bitbucket adapters (`packages/forge`)
- [ ] Pull request list + creation
- [ ] Issue viewer
- [ ] Code review comments inline in diffs

## Later — Power

- [ ] Worktree management
- [ ] Plugin host (palette commands, sidebar sections, inspector tabs)
- [ ] Multi-repo workspaces
- [ ] Performance: commit-graph file support for instant cold opens

## Known limitations

- **One account per host.** `accounts::add` keys by host, so adding a second account
  for the same host replaces the first — work and personal on one host cannot coexist.
- **Access tokens are not checked for expiry.** Atlassian API tokens and GitLab PATs
  expire; AngKorGit stores no expiry and gives no warning before a token stops working.

Non-goals: enterprise admin tooling, built-in CI dashboards, anything that duplicates a forge's web UI without daily value.
