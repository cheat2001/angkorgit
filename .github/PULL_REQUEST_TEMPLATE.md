## What & why

<!-- One paragraph: what this PR does and the problem it solves. Link issues with #123. -->

## Screenshots

<!-- Required for UI changes — both dark and light theme if colors are touched. -->

## Checklist

- [ ] `pnpm typecheck && pnpm test` pass
- [ ] `cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test` pass (if Rust changed)
- [ ] New engine functions have integration tests in `tests/git_engine.rs`
- [ ] Mutating operations go through the undo `tracked()` wrapper where undoable
- [ ] Colors use design tokens only (no hex in components)
- [ ] `CLAUDE.md` updated if conventions/architecture changed
