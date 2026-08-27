import { parseRemote } from './remote';

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
