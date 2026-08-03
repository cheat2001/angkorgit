# Roadmap

## 0.1 — Foundation (now)

- [x] Repository: open, clone (with progress), recents, search
- [x] Commit: stage files & hunks, unstage, commit, amend
- [x] History: virtualized animated graph, search, author/branch filters, refs/tags/HEAD/merges
- [x] Branch: create, delete, rename, checkout (incl. remote), merge, rebase (+continue/abort), cherry-pick, reset (soft/mixed/hard)
- [x] Remote: fetch, pull, push, force push, push/fetch tags
- [x] Conflicts: three-pane visual resolver (current / incoming / result)
- [x] Stash: create, apply, pop, drop
- [x] Tags: create (annotated/lightweight), delete, checkout
- [x] Submodules: list & update
- [x] Built-in PTY terminal at repo root
- [x] Diff: inline & side-by-side, syntax highlight, word diff, image diff
- [x] Settings: theme, identity, SSH, AI, shortcuts
- [x] AI module: provider-agnostic (OpenAI, Anthropic, Gemini, Ollama, LM Studio)

## 0.2 — Polish

- [ ] Interactive rebase (reorder/squash/reword) UI
- [ ] Blame view & file history
- [ ] Drag-and-drop in the graph (merge/rebase by dragging branches)
- [ ] Per-line staging (beyond hunks)
- [ ] Undo stack for recent operations
- [ ] GPG/SSH commit signing

## 0.3 — Connected (architecture in place, see Architecture.md)

- [ ] GitHub / GitLab / Azure DevOps / Bitbucket adapters (`packages/forge`)
- [ ] Pull request list + creation, PR description via AI
- [ ] Issue viewer
- [ ] Code review comments inline in diffs

## 0.4 — Power

- [ ] Worktree management
- [ ] Plugin host (palette commands, sidebar sections, inspector tabs)
- [ ] Multi-repo workspaces
- [ ] Performance: commit-graph file support for instant cold opens

Non-goals: enterprise admin tooling, built-in CI dashboards, anything that duplicates a forge's web UI without daily value.
