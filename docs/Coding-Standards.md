# Coding Standards

## TypeScript

- `strict` mode; no `any` (use `unknown` + narrowing). No non-null `!` outside tests and provably-safe layout code.
- Feature folders own their state: a feature's store is imported only via its public module. Cross-feature reads go through hooks, never internal setters.
- Pure logic (parsing, layout, diffing) lives in `@angkorgit/core`, is framework-free and unit-tested. React components stay thin.
- Components: function components + hooks only. `memo` for list rows; stable callbacks via `useCallback` only where a memoized child needs them.
- Imports: `@/` alias inside the app; workspace packages by name. No deep relative paths (`../../..`).
- Naming: `PascalCase` components, `camelCase` functions/values, `SCREAMING_SNAKE` constants. Files match their default export.
- Errors from IPC are `{ code, message }` — always surface `message` to the user via toast, never swallow.

## Rust

- `rustfmt` + `clippy -D warnings` are CI gates.
- Library errors convert into `AppError`; never `unwrap()` outside tests.
- Tauri commands are thin adapters; domain logic lives in `core/*` and is testable without Tauri.
- Blocking git work always goes through `spawn_blocking`.
- Public engine functions take `&str` paths and return serde types mirroring `@angkorgit/core` — keep the two in sync when changing either.

## CSS / design

- Tailwind utilities only; tokens come from the design system (`bg-surface`, `text-muted`, …). No hex colors in components.
- 8px spacing scale; no arbitrary values (`p-[13px]` is a review blocker).
- Dark theme is the default; every change must be checked in both themes.

## Commits & PRs

- Conventional commits: `feat(graph): …`, `fix(engine): …`, `docs: …`.
- A PR should do one thing; include screenshots/screencasts for UI changes.
- Tests accompany behavior: engine changes → `git_engine.rs`, domain logic → `tests/unit`, flows → Playwright.
