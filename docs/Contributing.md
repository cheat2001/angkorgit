# Contributing to AngKorGit

Thank you for helping make everyday Git delightful! 🙏

## Ground rules

- Be kind. We follow the [Contributor Covenant](https://www.contributor-covenant.org/version/2/1/code_of_conduct/).
- **Quality over quantity.** AngKorGit deliberately implements few features exceptionally well. New feature proposals should explain why the feature is *daily-use* — "GitKraken has it" is not a reason.
- Discuss before building: open an issue for anything larger than a fix.

## Workflow

1. Fork and branch from `main`: `feature/<short-name>` or `fix/<short-name>`.
2. Set up per [Development.md](Development.md); make your change following [Coding-Standards.md](Coding-Standards.md).
3. Make sure the gates pass locally:
   ```bash
   pnpm typecheck && pnpm test
   cd apps/desktop/src-tauri && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test
   ```
4. Open a PR with a conventional-commit title, a short "why", and screenshots for UI changes.

## What makes a good first contribution

- New language for syntax highlighting (`src/shared/highlight.ts`)
- A new AI provider adapter (`packages/core/src/ai/providers.ts`)
- Graph rendering polish, additional keyboard shortcuts, accessibility passes
- Engine test coverage in `tests/git_engine.rs`

## Reporting bugs

Include: OS, app version, the operation you ran, expected vs. actual, and — if the repo state matters — a minimal script that reproduces the repository shape. Never include private repository contents.
