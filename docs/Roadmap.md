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
- [x] Undo stack for recent operations
- [x] Drag-and-drop merge/rebase by dragging branches
- [x] Per-line staging (beyond hunks)

## 0.2 — Polish

- [ ] Interactive rebase (reorder/squash/reword) UI
- [ ] Blame view & file history
- [ ] GPG/SSH commit signing
- [ ] Find-in-diff polish & diff search refinements

## Known limitations

- **SSH keys must be RSA.** The vendored libssh2 that `libssh2-sys` builds defines
  only `LIBSSH2_OPENSSL`, never `LIBSSH2_ED25519` or `LIBSSH2_ECDSA`, so ed25519 and
  ECDSA keys fail through both the key-file path and the SSH agent — while the same
  key works with the `ssh` binary. Since ed25519 is the `ssh-keygen` default, this
  affects most existing keys. Lifting it means getting those defines into the
  vendored build (a patched `libssh2-sys`, or a different crypto backend) and is the
  highest-priority engine fix.
- **One account per host.** `accounts::add` keys by host, so adding a second account
  for the same host replaces the first — work and personal on one host cannot coexist.
- **Access tokens are not checked for expiry.** Atlassian API tokens and GitLab PATs
  expire; AngKorGit stores no expiry and gives no warning before a token stops working.

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
