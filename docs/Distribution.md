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

**[owner] one-time**: add BOTH GitHub secrets (verified locally 2026-08-04):
- `TAURI_SIGNING_PRIVATE_KEY` — the contents of `~/.tauri/angkorgit.key`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — set to an **empty value** (required:
  without the env var Tauri tries an interactive prompt and headless builds fail).

## 4. Homebrew cask **[after first signed release]**

Create `cheat2001/homebrew-tap` with `Casks/angkorgit.rb`:

```ruby
cask "angkorgit" do
  version "0.1.0"
  sha256 "<shasum -a 256 of the dmg>"
  url "https://github.com/cheat2001/angkorgit/releases/download/v#{version}/AngKorGit_#{version}_aarch64.dmg"
  name "AngKorGit"
  desc "Fast, beautiful, 8 MB Git client"
  homepage "https://github.com/cheat2001/angkorgit"
  app "AngKorGit.app"
end
```

Users then install with `brew install --cask cheat2001/tap/angkorgit`.
Once the project has traction (75+ stars, 30+ forks), submit to homebrew-cask
proper for `brew install --cask angkorgit`.

## 5. Website checklist (future)

- Hero: dark-theme graph screenshot + "Everyday Git, made delightful" + download button
- The 8 MB vs ~1 GB comparison, 15-second workflow GIF, feature grid
- `latest.json` doubles as the website's "current version" source
- Link CHANGELOG.md as the release notes page
