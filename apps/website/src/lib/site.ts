const FALLBACK_VERSION = '0.6.2';

async function latestReleaseVersion(): Promise<string> {
  try {
    const res = await fetch('https://api.github.com/repos/cheat2001/angkorgit/releases/latest', {
      headers: { accept: 'application/vnd.github+json' },
    });
    if (!res.ok) return FALLBACK_VERSION;
    const data = (await res.json()) as { tag_name?: string };
    const tag = typeof data.tag_name === 'string' ? data.tag_name : '';
    return /^v\d+\.\d+\.\d+$/.test(tag) ? tag.slice(1) : FALLBACK_VERSION;
  } catch {
    return FALLBACK_VERSION;
  }
}

export const SITE = {
  name: 'AngKorGit',
  alternateNames: ['Angkor Git', 'AngkorGit', 'angkorgit', 'Git Angkor', 'GitAngkor', 'gitangkor'],
  title:
    'AngKorGit (Angkor Git) — fast, free Git client and Git GUI for macOS, Windows & Linux',
  description:
    'Angkor Git (AngKorGit) is a fast, free, open-source Git client and Git GUI for macOS, Windows, and Linux — a 12 MB download (Tauri v2 + Rust + libgit2). Visual commit graphs, side-by-side diff review, visual conflict resolution, and AI assistance.',
  repo: 'https://github.com/cheat2001/angkorgit',
  releases: 'https://github.com/cheat2001/angkorgit/releases',
  license: 'https://github.com/cheat2001/angkorgit/blob/main/LICENSE',
  docs: 'https://github.com/cheat2001/angkorgit/tree/main/docs',
  contributing: 'https://github.com/cheat2001/angkorgit/blob/main/docs/Contributing.md',
  codeOfConduct: 'https://github.com/cheat2001/angkorgit/blob/main/CODE_OF_CONDUCT.md',
  security: 'https://github.com/cheat2001/angkorgit/blob/main/SECURITY.md',
  ci: 'https://github.com/cheat2001/angkorgit/actions/workflows/ci.yml',
  buyMeACoffee: 'https://buymeacoffee.com/chansocheatsok',
  tagline: 'Everyday Git, made delightful.',
  latestVersion: await latestReleaseVersion(),
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
  { href: '/#faq', label: 'FAQ' },
] as const;
