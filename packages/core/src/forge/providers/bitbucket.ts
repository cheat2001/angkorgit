import type { HttpClient } from '../../ai/types';
import type { ForgeRemote } from '../remote';
import type { ForgeProvider } from '../provider';
import {
  ForgeError,
  type CreatePullRequestInput,
  type PullRequestCheckoutSpec,
  type PullRequestInfo,
} from '../types';

interface BitbucketEndpoint {
  branch?: { name?: string };
  commit?: { hash?: string };
  repository?: { full_name?: string } | null;
}

interface BitbucketPull {
  id: number;
  title?: string;
  state?: string;
  draft?: boolean;
  created_on?: string;
  updated_on?: string;
  author?: { display_name?: string; nickname?: string; links?: { avatar?: { href?: string } } } | null;
  source?: BitbucketEndpoint;
  destination?: BitbucketEndpoint;
  links?: { html?: { href?: string } };
}

function toUnix(iso: string | undefined): number {
  const ms = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0;
}

function bitbucketMessage(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string; detail?: string } };
    const message = parsed.error?.message ?? null;
    const detail = parsed.error?.detail;
    return message && detail ? `${message} (${detail})` : message;
  } catch {
    return null;
  }
}

export function bitbucketForgeProvider(remote: ForgeRemote, http: HttpClient): ForgeProvider {
  const apiBase = 'https://api.bitbucket.org/2.0';
  const repoPath = `${remote.owner}/${remote.repo}`;

  const request = async (method: 'GET' | 'POST', path: string, payload?: unknown): Promise<unknown> => {
    const res = await http({
      url: `${apiBase}${path}`,
      method,
      headers: payload === undefined ? {} : { 'content-type': 'application/json' },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
    if (res.status < 200 || res.status >= 300) {
      const detail = bitbucketMessage(res.body);
      throw new ForgeError(
        `Bitbucket request failed (${res.status})${detail ? `: ${detail}` : ''}`,
        'bitbucket',
        res.status,
      );
    }
    try {
      return JSON.parse(res.body);
    } catch {
      throw new ForgeError('Bitbucket returned invalid JSON', 'bitbucket');
    }
  };

  const mapPull = (pull: BitbucketPull): PullRequestInfo => {
    const sourceRepo = pull.source?.repository?.full_name ?? null;
    return {
      number: pull.id,
      title: pull.title ?? `#${pull.id}`,
      author: pull.author?.nickname ?? pull.author?.display_name ?? 'unknown',
      authorAvatarUrl: pull.author?.links?.avatar?.href ?? null,
      sourceBranch: pull.source?.branch?.name ?? '',
      targetBranch: pull.destination?.branch?.name ?? '',
      url: pull.links?.html?.href ?? remote.webUrl,
      state: pull.state === 'MERGED' ? 'merged' : pull.state === 'OPEN' ? 'open' : 'closed',
      isDraft: pull.draft === true,
      isFromFork: sourceRepo === null || sourceRepo.toLowerCase() !== repoPath.toLowerCase(),
      headSha: pull.source?.commit?.hash ?? '',
      createdAt: toUnix(pull.created_on),
      updatedAt: toUnix(pull.updated_on),
    };
  };

  return {
    kind: 'bitbucket',
    label: 'Bitbucket',
    async listOpenPullRequests(): Promise<PullRequestInfo[]> {
      const data = (await request(
        'GET',
        `/repositories/${repoPath}/pullrequests?state=OPEN&pagelen=50`,
      )) as { values?: BitbucketPull[] };
      if (!Array.isArray(data.values)) {
        throw new ForgeError('Bitbucket returned an unexpected response', 'bitbucket');
      }
      return data.values.map(mapPull);
    },
    async defaultBranch(): Promise<string> {
      const data = (await request('GET', `/repositories/${repoPath}`)) as {
        mainbranch?: { name?: string };
      };
      return data.mainbranch?.name ?? 'main';
    },
    async createPullRequest(input: CreatePullRequestInput): Promise<PullRequestInfo> {
      const data = (await request('POST', `/repositories/${repoPath}/pullrequests`, {
        title: input.title,
        description: input.body,
        source: { branch: { name: input.sourceBranch } },
        destination: { branch: { name: input.targetBranch } },
        ...(input.draft ? { draft: true } : {}),
      })) as BitbucketPull;
      return mapPull(data);
    },
    checkoutSpec(pr: PullRequestInfo): PullRequestCheckoutSpec | null {
      if (pr.isFromFork || !pr.sourceBranch) return null;
      return { sourceRef: `refs/heads/${pr.sourceBranch}`, localBranch: pr.sourceBranch, track: true };
    },
  };
}
