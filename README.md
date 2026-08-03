<p align="center">
  <img src="apps/desktop/src-tauri/icons/icon.png" width="96" alt="AngKorGit" />
</p>

<h1 align="center">AngKorGit</h1>

<p align="center">
  A modern, fast, beautiful cross-platform Git client.<br/>
  Inspired by Angkor Wat — strength, simplicity, and craftsmanship from Cambodia. 🇰🇭
</p>

---

AngKorGit focuses on the Git operations developers actually use every day and executes them exceptionally well: staging (down to individual hunks), committing, branching, merging, rebasing, cherry-picking, stashing, tagging, a beautiful animated commit graph, a visual three-pane conflict resolver, a built-in terminal, and an AI assistant that works with **any** provider (OpenAI, Anthropic, Gemini, Ollama, LM Studio).

## Highlights

- **Fast by architecture** — Rust + libgit2 engine, virtualized graph rendering, incremental history loading. 100k-commit repositories stay smooth.
- **Keyboard-first** — a ⌘K command palette reaches every daily operation; every panel has shortcuts.
- **Beginner-friendly** — conflicts become three panes with *Accept Current / Incoming / Both* buttons, destructive actions confirm first, errors speak human.
- **Dark by default**, light theme included. Temple Gold `#D97706` accents, Inter + JetBrains Mono, 8px spacing rhythm.
- **AI where it helps** — generate commit messages, explain diffs and conflicts, draft PR descriptions, review staged changes. No provider hardcoded, local models welcome.

## Getting started

Prerequisites: [Node 20+](https://nodejs.org), [pnpm 9+](https://pnpm.io), [Rust stable](https://rustup.rs) and the [Tauri v2 system deps](https://v2.tauri.app/start/prerequisites/).

```bash
pnpm install
pnpm icons          # generate placeholder app icons
pnpm tauri:dev      # run the desktop app
```

Browser-only UI development (no Rust toolchain needed — runs on a demo dataset):

```bash
pnpm dev            # http://localhost:1420
```

Tests:

```bash
pnpm test           # unit tests (graph layout, word diff, conflict parser)
pnpm test:e2e       # Playwright, against demo mode
cd apps/desktop/src-tauri && cargo test   # git engine integration tests
```

## Repository layout

| Path | Contents |
| --- | --- |
| `apps/desktop` | The Tauri v2 desktop app (React frontend + Rust engine) |
| `packages/core` | Domain types, graph layout, word diff, conflict parsing, AI module |
| `packages/design-system` | Design tokens, Tailwind preset, UI primitives, logo |
| `docs` | Architecture, UI guidelines, roadmap, coding standards |
| `tests` | Unit + e2e tests |
| `scripts` | Icon generation and tooling |

Read more in [docs/Architecture.md](docs/Architecture.md) and [docs/Development.md](docs/Development.md).

## License

MIT
Nice