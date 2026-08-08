export const SITE = {
  name: 'AngKorGit',
  title: 'AngKorGit — Fast Open-Source Git Client for macOS, Windows & Linux',
  description:
    'AngKorGit is a fast, free, open-source Git client for macOS, Windows, and Linux — only ~8 MB (Tauri v2 + Rust + libgit2). Visual commit graphs, side-by-side diff review, visual conflict resolution, and AI assistance.',
  repo: 'https://github.com/cheat2001/angkorgit',
  releases: 'https://github.com/cheat2001/angkorgit/releases',
  license: 'https://github.com/cheat2001/angkorgit/blob/main/LICENSE',
  docs: 'https://github.com/cheat2001/angkorgit/tree/main/docs',
  contributing: 'https://github.com/cheat2001/angkorgit/blob/main/CONTRIBUTING.md',
  codeOfConduct: 'https://github.com/cheat2001/angkorgit/blob/main/CODE_OF_CONDUCT.md',
  security: 'https://github.com/cheat2001/angkorgit/blob/main/SECURITY.md',
  ci: 'https://github.com/cheat2001/angkorgit/actions/workflows/ci.yml',
  tagline: 'Everyday Git, made delightful.',
  latestVersion: '0.1.2',
  latestUrl: 'https://github.com/cheat2001/angkorgit/releases',
  assetUrl: (version: string, asset: string) =>
    `https://github.com/cheat2001/angkorgit/releases/download/v${version}/${asset}`,
};

export const NAV = [
  { href: '/#features', label: 'Features' },
  { href: '/#gallery', label: 'Gallery' },
  { href: '/#performance', label: 'Performance' },
  { href: '/#install', label: 'Install' },
  { href: '/#ai', label: 'AI' },
  { href: '/docs/', label: 'Docs' },
  { href: '/#open-source', label: 'Open source' },
] as const;
