interface ParsedRemote {
  scheme: string;
  host: string;
  path: string;
}

function parseRemote(url: string): ParsedRemote | null {
  const trimmed = url.trim().replace(/\/$/, '').replace(/\.git$/, '');
  const web = trimmed.match(/^(https?):\/\/(?:[^@/]+@)?([^/]+)\/(.+)$/);
  if (web) return { scheme: web[1], host: web[2], path: web[3] };
  const ssh = trimmed.match(/^ssh:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+)$/);
  if (ssh) return { scheme: 'https', host: ssh[1], path: ssh[2] };
  const scp = trimmed.match(/^(?:[^@/]+@)([^:/]+):(.+)$/);
  if (scp) return { scheme: 'https', host: scp[1], path: scp[2] };
  return null;
}

export function pullRequestUrl(remoteUrl: string, branch: string): string | null {
  if (!branch) return null;
  const remote = parseRemote(remoteUrl);
  if (!remote) return null;
  const hostname = remote.host.split(':')[0];
  const base = `${remote.scheme}://${remote.host}/${remote.path}`;
  const encoded = encodeURIComponent(branch);
  if (hostname === 'bitbucket.org') {
    return `${base}/pull-requests/new?source=${encoded}`;
  }
  if (hostname.includes('bitbucket')) {
    const segments = remote.path.split('/');
    if (segments[0] === 'scm' && segments.length >= 3) {
      const project = segments[1].toUpperCase();
      const repo = segments.slice(2).join('/');
      const source = encodeURIComponent(`refs/heads/${branch}`);
      return `${remote.scheme}://${remote.host}/projects/${project}/repos/${repo}/pull-requests?create&sourceBranch=${source}`;
    }
    return null;
  }
  if (hostname.includes('gitlab')) {
    return `${base}/-/merge_requests/new?merge_request%5Bsource_branch%5D=${encoded}`;
  }
  if (hostname.includes('github')) {
    return `${base}/compare/${encoded}?expand=1`;
  }
  return null;
}
