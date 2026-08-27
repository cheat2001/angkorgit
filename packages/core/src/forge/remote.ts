import type { RemoteInfo } from '../git/types';

export interface ParsedRemote {
  scheme: string;
  host: string;
  path: string;
}

export function parseRemote(url: string): ParsedRemote | null {
  const trimmed = url.trim().replace(/\/$/, '').replace(/\.git$/, '');
  const web = trimmed.match(/^(https?):\/\/(?:[^@/]+@)?([^/]+)\/(.+)$/);
  if (web) return { scheme: web[1], host: web[2], path: web[3] };
  const ssh = trimmed.match(/^ssh:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+)$/);
  if (ssh) return { scheme: 'https', host: ssh[1], path: ssh[2] };
  const scp = trimmed.match(/^(?:[^@/]+@)([^:/]+):(.+)$/);
  if (scp) return { scheme: 'https', host: scp[1], path: scp[2] };
  return null;
}

export function pickForgeRemote(
  remotes: RemoteInfo[],
  headUpstream: string | null,
): RemoteInfo | null {
  if (remotes.length === 0) return null;
  const upstreamRemote = headUpstream?.split('/')[0];
  if (upstreamRemote) {
    const match = remotes.find((remote) => remote.name === upstreamRemote);
    if (match) return match;
  }
  return remotes.find((remote) => remote.name === 'origin') ?? remotes[0];
}

export type ForgeKind = 'github' | 'gitlab' | 'bitbucket';

export interface ForgeRemote {
  kind: ForgeKind;
  scheme: string;
  host: string;
  owner: string;
  repo: string;
  webUrl: string;
}

export function parseForgeRemote(url: string): ForgeRemote | null {
  const remote = parseRemote(url);
  if (!remote) return null;
  const hostname = remote.host.split(':')[0];
  const segments = remote.path.split('/').filter(Boolean);
  const webUrl = `${remote.scheme}://${remote.host}/${remote.path}`;
  const base = { scheme: remote.scheme, host: remote.host, webUrl };

  if (hostname.includes('github')) {
    if (segments.length !== 2) return null;
    return { kind: 'github', owner: segments[0], repo: segments[1], ...base };
  }
  if (hostname === 'bitbucket.org') {
    if (segments.length !== 2) return null;
    return { kind: 'bitbucket', owner: segments[0], repo: segments[1], ...base };
  }
  if (hostname.includes('bitbucket')) {
    if (segments[0] !== 'scm' || segments.length < 3) return null;
    return { kind: 'bitbucket', owner: segments[1], repo: segments.slice(2).join('/'), ...base };
  }
  if (hostname.includes('gitlab')) {
    if (segments.length < 2) return null;
    return {
      kind: 'gitlab',
      owner: segments.slice(0, -1).join('/'),
      repo: segments[segments.length - 1],
      ...base,
    };
  }
  return null;
}
