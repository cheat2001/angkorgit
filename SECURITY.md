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
- **Network** — outbound only: git remotes you configure, Gravatar (avatar
  lookup by email hash), and the AI provider you explicitly configure.
  There is **no telemetry, no analytics, and no phoning home.**
- **PTY** — the built-in terminal runs your login shell in the repository
  directory, with your user's normal permissions.

## Reporting a Vulnerability

Please **do not open a public issue** for security problems.

Instead, use GitHub's private vulnerability reporting on this repository
(*Security → Report a vulnerability*). Include reproduction steps and impact.

You can expect an acknowledgment within a few days. Fixes are released as soon
as practical, credited to the reporter unless anonymity is requested.
