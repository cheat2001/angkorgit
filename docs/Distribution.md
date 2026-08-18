# Distribution Guide

How AngKorGit ships to users: signing, notarization, auto-updates, and package
managers. Steps marked **[owner]** need the project owner's accounts/keys and
cannot be automated by contributors.

## 1. Versioning & releases (works today)

1. Update the version in `apps/desktop/src-tauri/tauri.conf.json`,
   `apps/desktop/src-tauri/Cargo.toml`, and root/app `package.json`.
2. Move `[Unreleased]` items in `CHANGELOG.md` under the new version heading.
3. Commit, tag `vX.Y.Z`, push the tag → `.github/workflows/release.yml` builds
   macOS (universal), Windows, and Linux bundles via `tauri-action` and attaches
   them to a **draft** GitHub release. Review, paste the changelog section, publish.

## 2. Distribution WITHOUT paid signing (the current, chosen approach)

AngKorGit ships **unsigned** — free and independent. Users get one extra step
on first launch; document it prominently (README covers this):

- **macOS**: the app isn't notarized, so Gatekeeper blocks the first open.
  Either right-click the app → **Open** → Open, or on newer macOS:
  **System Settings → Privacy & Security → "AngKorGit was blocked" → Open Anyway**.
  Terminal alternative: `xattr -cr /Applications/AngKorGit.app` (removes the
  quarantine flag). Tauri ad-hoc-signs the binary automatically, so it runs
  fine on Apple Silicon once past Gatekeeper.
- **Windows**: SmartScreen shows "Windows protected your PC" →
  **More info → Run anyway**.
- **Linux**: AppImage: `chmod +x AngKorGit_*.AppImage` and run; `.deb` installs
  normally.

**macOS Keychain prompts**: account tokens live in the Keychain, and macOS
cannot durably trust an unsigned binary — "Always Allow" does not stick, so
the first git operation that needs a token asks for permission **once per app
session** (keyring reads are cached in-process; `accounts.rs` `TOKEN_CACHE`).
Click **Allow** (not "Always Allow" — it has no effect). One prompt per launch
is expected behavior for unsigned builds; a paid Developer ID signature is the
only way to make authorization permanent.

**macOS folder-access prompts (Desktop/Documents/Downloads)**: consent is
keyed to the app's code signature. One installed build → one prompt per
folder, then it persists. Each UPDATE (new ad-hoc signature) may re-ask once.
An endless prompt loop means stale/conflicting records from replaced binaries
(typical on a dev machine installing many builds): fix with
`tccutil reset All dev.angkorgit.app`, then relaunch and Allow once. Users
must drag the app out of the dmg into /Applications — running it from inside
the dmg triggers app translocation, where grants can never persist.

Security honesty: unsigned ≠ unsafe. Releases are built by public GitHub
Actions from public source, updates are minisign-verified (§3), and users can
always build from source. If the project later earns sponsorship, Apple
notarization (~$99/yr) can be added — the workflow snippet lives in git
history — purely to remove the first-launch step.

## 3. Auto-updates — ACTIVE ✅ (free, Apple-independent)

Updates are pull-based from GitHub releases and verified with the project's
**own minisign key** before installing — a tampered download will never run.

Already wired in the codebase:
- Keypair generated; **private key: `~/.tauri/angkorgit.key` on the owner's
  machine — BACK IT UP. If lost, existing installs can never update again.**
  Public key: embedded in `tauri.conf.json → plugins.updater.pubkey`.
- `tauri-plugin-updater` + `tauri-plugin-process` registered; capability
  `updater:default`, `process:default`; `bundle.createUpdaterArtifacts: true`.
- Frontend: silent check 5s after startup (`features/updater/check.ts`) →
  "Update available" toast with **Update now** (download, verify, relaunch);
  manual **Check for updates** in the Settings rail footer.
- `release.yml` passes `TAURI_SIGNING_PRIVATE_KEY(_PASSWORD)` to tauri-action,
  which then also generates and uploads `latest.json`.

**[owner] one-time — done**: both GitHub secrets are configured (releases since
0.2.0 ship `.sig` files and `latest.json`):
- `TAURI_SIGNING_PRIVATE_KEY` — the contents of `~/.tauri/angkorgit.key`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — set to an **empty value** (required:
  without the env var Tauri tries an interactive prompt and headless builds fail).

## 4. Homebrew cask **[live — own tap]**

Published at `cheat2001/homebrew-tap` (`Casks/angkorgit.rb`). Install:

```sh
brew install --cask cheat2001/tap/angkorgit --no-quarantine
```

(`--no-quarantine` because the app is unsigned; without it macOS quarantines
the download and users must `xattr -cr /Applications/AngKorGit.app` — the
cask's caveats explain this.)

**On every release** the cask must be bumped: update `version` and `sha256`
(`shasum -a 256` of the new universal dmg) in
`cheat2001/homebrew-tap/Casks/angkorgit.rb`. The cask sets `auto_updates true`
(the app self-updates), so tap users who installed once still get new versions
in-app; the bump matters for fresh installs. Add this to the release checklist.

Once the project has traction (75+ stars, 30+ forks) AND the app is
signed/notarized, submit to homebrew-cask proper for
`brew install --cask angkorgit`.

## 5. Website (live)

- Live at `https://angkorgit.app/` (Astro, static, GitHub Pages via
  `.github/workflows/website.yml`; custom domain + HTTPS enforced).
- Sections: hero with graph screenshot, features, gallery, performance, AI,
  install (per-OS download cards + terminal one-liners with copy buttons),
  open-source, final CTA.
- Docs are rendered on-site at `/docs/` directly from `docs/*.md` (see
  `apps/website/src/content.config.ts`) — edit a doc and the site updates on
  the next deploy; no duplication.
- SEO: meta/OG/JSON-LD, sitemap, Google Search Console verified
  (URL-prefix property), `robots.txt` → `sitemap-index.xml`.
- Launch/verification runbook: `docs/Launch-Checklist.md`.
