# Security Policy

## Supported Versions

AngKorGit is pre-1.0; only the latest release receives security fixes.

| Version | Supported |
| --- | --- |
| latest release | ✅ |
| older releases | ❌ |

## What AngKorGit touches on your machine

For transparency, the app's security-relevant surface is:

- **Your repositories** — read/write via libgit2, only for repositories you open.
- **OS keychain** — hosting-account tokens are stored under the `AngKorGit`
  keychain service; committer identity is written to per-repository git config.
  Tokens never reach `accounts.json`, which holds only host, username, provider
  and whether the token was verified. A token is offered only to the host it was
  saved for.
- **SSH keys** — read from disk (and the SSH agent) to authenticate `git@`
  remotes; never copied or transmitted anywhere else. Keys created by
  Settings → Authentication → SSH are ed25519 and are written **without a
  passphrase**, because AngKorGit cannot prompt for one — a passphrase-protected
  key only works via your SSH agent. Generation never overwrites an existing key.
- **AI provider keys** — API keys you enter in Settings → AI are stored in the
  app's local settings (the webview's local storage on your machine), **not** in
  the OS keychain, and are sent only to the provider you configured. Prefer the
  installed-CLI or local-model providers if you'd rather store no key at all.
- **AI CLIs** — if you select an installed AI CLI (Claude Code, Codex, Gemini
  CLI, OpenCode), AngKorGit runs that binary as a local subprocess with your
  user's permissions. Only a fixed allowlist of known CLI programs can be run.
- **Network** — outbound only: git remotes you configure, Gravatar (avatar
  lookup by email hash), the AI provider you explicitly configure, and the
  updater, which checks GitHub Releases for a new signed build shortly after
  startup. There is **no telemetry and no analytics.**
- **PTY** — the built-in terminal runs your login shell in the repository
  directory, with your user's normal permissions.

## Reporting a Vulnerability

Please **do not open a public issue** for security problems.

Instead, use GitHub's private vulnerability reporting on this repository
(*Security → Report a vulnerability*). Include reproduction steps and impact.

You can expect an acknowledgment within a few days. Fixes are released as soon
as practical, credited to the reporter unless anonymity is requested.
