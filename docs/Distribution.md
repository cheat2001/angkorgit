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

## 2. macOS code signing & notarization **[owner]**

Unsigned apps trigger Gatekeeper's "unidentified developer" wall — the #1
adoption killer. One-time setup:

1. Join the [Apple Developer Program](https://developer.apple.com/programs/) (~$99/yr).
2. In Xcode / developer portal, create a **Developer ID Application** certificate;
   export it as `certificate.p12` with a password.
3. Create an App Store Connect **API key** (for notarization) or use an
   app-specific Apple ID password.
4. Add GitHub repository secrets:
   - `APPLE_CERTIFICATE` (base64 of the .p12), `APPLE_CERTIFICATE_PASSWORD`
   - `APPLE_ID`, `APPLE_PASSWORD` (app-specific), `APPLE_TEAM_ID`
5. In `release.yml`, pass them to `tauri-action`'s env — it signs and notarizes
   automatically:

```yaml
env:
  GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
  APPLE_CERTIFICATE: ${{ secrets.APPLE_CERTIFICATE }}
  APPLE_CERTIFICATE_PASSWORD: ${{ secrets.APPLE_CERTIFICATE_PASSWORD }}
  APPLE_ID: ${{ secrets.APPLE_ID }}
  APPLE_PASSWORD: ${{ secrets.APPLE_PASSWORD }}
  APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
```

Windows: an OV/EV code-signing certificate (e.g. via Azure Trusted Signing)
removes SmartScreen warnings — same pattern, `tauri-action` supports it.

## 3. Auto-updates (tauri-plugin-updater) **[owner for keys]**

Design decision: updates are **pull-based from GitHub releases** — no server.

1. Generate the update signing keypair (once, keep the private key safe):
   ```bash
   pnpm --filter @angkorgit/desktop exec tauri signer generate -w ~/.tauri/angkorgit.key
   ```
2. Add to `tauri.conf.json`:
   ```json
   "plugins": {
     "updater": {
       "pubkey": "<public key from step 1>",
       "endpoints": [
         "https://github.com/cheat2001/angkorgit/releases/latest/download/latest.json"
       ]
     }
   }
   ```
3. Add the crate + JS plugin (`tauri-plugin-updater`, `@tauri-apps/plugin-updater`),
   register `.plugin(tauri_plugin_updater::Builder::new().build())`, permission
   `updater:default`.
4. Add GitHub secrets `TAURI_SIGNING_PRIVATE_KEY` (+ password); `tauri-action`
   then produces signed update artifacts and `latest.json` automatically.
5. Frontend: on startup, `check()` → toast "Update available — Restart to
   install" → `downloadAndInstall()`. Wire it in `App.tsx` behind a settings toggle.

Until keys exist, this stays documentation — adding the plugin without a pubkey
breaks builds.

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
