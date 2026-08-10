# Getting Started

Download the latest release for your platform from the
[releases page](https://github.com/cheat2001/angkorgit/releases).

AngKorGit is free, open-source software and is **not signed with a paid
certificate**, so your OS asks for a few extra confirmations on first launch.

## macOS — first launch, step by step

1. Open the `.dmg` and **drag AngKorGit into Applications**. Don't launch it
   from inside the dmg window — macOS would run it from a temporary sandbox
   where permissions can never be saved.
2. Launch it. macOS shows *"AngKorGit" cannot be opened* with **Move to
   Trash** — this only means the app has no paid Apple certificate. Close it,
   then go to **System Settings → Privacy & Security**, scroll down, and click
   **"Open Anyway"** next to the AngKorGit message. Confirm once more. This
   happens only on the very first launch.
3. When you open a repository in Desktop/Documents/Downloads, macOS asks
   *"AngKorGit would like to access files in your … folder"* → **Allow**.
   One prompt per folder, then it's remembered.
4. If you connect a GitHub/GitLab account, the first git operation per app
   session asks to read the token from your Keychain → **Allow** (plain
   "Allow" — "Always Allow" has no effect on unsigned apps).

Expect **2–3 clicks total on first run**, then one folder re-confirmation
after app updates (each unsigned build has a new identity). If a permission
dialog ever loops endlessly, reset the stale records and try again:

```sh
tccutil reset All dev.angkorgit.app
```

## Windows & Linux

| Platform | First launch |
| --- | --- |
| **Windows** | SmartScreen: **More info → Run anyway** |
| **Linux** | AppImage: `chmod +x AngKorGit_*.AppImage`, then run — or install the `.deb` |

After that, AngKorGit **updates itself**: every update is cryptographically
verified (minisign) before installing, and all releases are built in public by
GitHub Actions from this source tree. No telemetry, ever.

## Connecting to a remote

AngKorGit picks its credential from the **remote URL**, not from a setting:

| Remote | Credential |
| --- | --- |
| `https://host/group/repo.git` | an account in **Settings → Authentication** (a token in your OS keychain) |
| `git@host:group/repo.git` | an **SSH key** |

Adding an account does nothing for an SSH remote, and an SSH key does nothing
for an HTTPS one. If a pull or push fails, the remote URL is the first thing
to check — `git remote -v`.

### SSH keys

Settings → Authentication → SSH → **Generate a key** creates an ed25519 keypair
and shows the public key to copy into your host. Existing keys are never
overwritten — generation always picks a free filename, so a second key becomes
`angkorgit_ed25519_2` rather than replacing the first.

If your key has a name AngKorGit does not try by default (`~/.ssh/id_ed25519`
and `~/.ssh/id_rsa`), set it in the **Private key** field or browse for it.

Passphrase-protected keys only work through the SSH agent, because AngKorGit
never prompts for a passphrase. Run `ssh-add <key>` first, and leave
**Use the SSH agent** on.

A key generated in AngKorGit is used by AngKorGit; other tools keep using
`~/.ssh/id_*` unless you point them at it with an `~/.ssh/config` entry:

```
Host github.com
  IdentityFile ~/.ssh/angkorgit_ed25519
  IdentitiesOnly yes
```
