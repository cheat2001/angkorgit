# UI Guidelines

AngKorGit's interface should feel like a professional developer tool: minimal, fast, discoverable. Visual influences — Linear's restraint, Raycast's keyboard focus, VS Code's density, GitKraken's graph clarity — reinterpreted, never copied.

## Layout

- **Left sidebar** — repositories context: branches, remotes, tags, stashes, submodules. Filterable.
- **Center** — the commit graph (the heart of the app), with the terminal docked below.
- **Right inspector** — working copy (staging + commit) by default; commit details when a commit is selected.
- All panels are resizable (`react-resizable-panels`) and persist their sizes.

## Design tokens

Everything visual flows from CSS variables: the base dark/light palettes live in
`packages/design-system/src/tokens.css`, and every other theme (including the
default **Angkor Dusk** and its light counterpart **Angkor Dawn**) redefines the
same tokens in `packages/design-system/src/themes.css`. Sixteen themes ship in
total; a change must hold up at least in the default Angkor Dusk plus one light
theme.

| Token | Base dark values | Purpose |
| --- | --- | --- |
| `--primary` | Temple Gold `#D97706` | actions, HEAD, brand |
| `--background` / `--surface` / `--surface-raised` / `--surface-overlay` | slate scale around `#111827` (Angkor Dusk: warm laterite around `#1e150d`) | depth levels 0–3 |
| `--danger` | `#EF4444` | destructive actions, deletions |
| `--success` | `#22C55E` | additions, confirmations |
| `--graph-0…9` | 10-color wheel | commit graph lanes |

The kbach colonnade ornament (`TemplePattern`) appears only on the welcome and
splash screens, only in the Angkor Dusk/Dawn themes, at low opacity — never
behind the graph, diffs, or code, and invisible in every other theme.

Rules:

- **8px rhythm.** Spacing uses the Tailwind scale (`gap-2`, `p-4`…). No arbitrary pixel values.
- **Typography.** Inter for UI, JetBrains Mono for anything Git: hashes, paths, diffs, messages being authored.
- **Radii.** `rounded-md` for controls, `rounded-lg` for surfaces. Nothing sharp, nothing pill-shaped except badges.
- **Elevation.** Prefer borders (`border-border-subtle`) over shadows; `shadow-soft` only for overlays.
- **Color = meaning.** Green is additions/success, red is deletions/danger, gold is primary/HEAD, blue is remote/info. Never decorative.

## Motion

Subtle, purposeful, interruptible:

- Durations 150–250ms; easing `cubic-bezier(0.16, 1, 0.3, 1)`.
- Animate opacity/transform only — never layout properties in scrolling lists.
- The splash logo draw (1.6s) is the single "hero" animation in the app.
- Respect the *Reduce motion* setting.

## Interaction principles

- **Everything keyboard-reachable.** Every action in a menu is also in the ⌘K palette. Shortcuts render next to labels (`Kbd`).
- **Discoverable.** Icon buttons always have tooltips; empty states say what to do next.
- **Safe by default.** Destructive operations (hard reset, discard, force push) require explicit confirmation and are styled `danger`.
- **Feedback within 100ms.** Long operations set a busy label in the toolbar; results arrive as toasts. Conflict outcomes are warnings (amber), not failures.
- **Optimistic where safe.** Staging/unstaging refreshes status only; the graph reloads only when history actually changes.

## Writing style

Sentence case everywhere ("Create branch", not "Create Branch"). Errors say what failed and what to do: "Push failed: no upstream — push with 'Set upstream' instead." No jargon beyond Git's own vocabulary.
