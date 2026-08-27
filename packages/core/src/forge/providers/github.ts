import type { HttpClient } from '../../ai/types';
import type { ForgeRemote } from '../remote';
import type { ForgeProvider } from '../provider';
import {
  ForgeError,
  type CreatePullRequestInput,
  type ForgeUser,
  type PullRequestCheckoutSpec,
  type PullRequestInfo,
} from '../types';

interface GithubUser {
  login?: string;
  avatar_url?: string;
}

interface GithubRef {
  ref?: string;
  sha?: string;
  repo?: { full_name?: string } | null;
}

interface GithubPull {
  number: number;
  title?: string;
  html_url?: string;
  state?: string;
  draft?: boolean;
  merged_at?: string | null;
  created_at?: string;
  updated_at?: string;
  user?: GithubUser | null;
  head?: GithubRef;
  base?: GithubRef;
}

export function githubApiBase(host: string): string {
  const hostname = host.split(':')[0];
  return hostname === 'github.com' ? 'https://api.github.com' : `https://${host}/api/v3`;
}

function toUnix(iso: string | undefined): number {
  const ms = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0;
}

interface GithubErrorEntry {
  message?: string;
  resource?: string;
  field?: string;
  code?: string;
}

function githubErrorDetail(entry: GithubErrorEntry | string): string {
  if (typeof entry === 'string') return entry;
  if (entry.message) return entry.message;
  const parts = [entry.resource, entry.field, entry.code].filter(Boolean).join(' ');
  if (!parts) return '';
  if (entry.field === 'head' && entry.code === 'invalid') {
    return `${parts} — the source branch does not exist on this remote (is it pushed there?)`;
  }
  return parts;
}

function githubMessage(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as {
      message?: string;
      errors?: Array<GithubErrorEntry | string>;
    };
    const detail = parsed.errors?.map(githubErrorDetail).filter(Boolean).join('; ');
    if (parsed.message && detail) return `${parsed.message}: ${detail}`;
    return detail || parsed.message || null;
  } catch {
    return null;
  }
}

export function githubForgeProvider(remote: ForgeRemote, http: HttpClient): ForgeProvider {
  const apiBase = githubApiBase(remote.host);
  const repoPath = `${remote.owner}/${remote.repo}`;

  const request = async (method: 'GET' | 'POST', path: string, payload?: unknown): Promise<unknown> => {
    const res = await http({
      url: `${apiBase}${path}`,
      method,
      headers: payload === undefined ? {} : { 'content-type': 'application/json' },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
    if (res.status < 200 || res.status >= 300) {
      const detail = githubMessage(res.body);
      throw new ForgeError(
        `GitHub request failed (${res.status})${detail ? `: ${detail}` : ''}`,
        'github',
        res.status,
      );
    }
    try {
      return JSON.parse(res.body);
    } catch {
      throw new ForgeError('GitHub returned invalid JSON', 'github');
    }
  };

  const mapPull = (pull: GithubPull): PullRequestInfo => {
    const headRepo = pull.head?.repo?.full_name ?? null;
    return {
      number: pull.number,
      title: pull.title ?? `#${pull.number}`,
      author: pull.user?.login ?? 'unknown',
      authorAvatarUrl: pull.user?.avatar_url ?? null,
      sourceBranch: pull.head?.ref ?? '',
      targetBranch: pull.base?.ref ?? '',
      url: pull.html_url ?? remote.webUrl,
      state: pull.merged_at ? 'merged' : pull.state === 'closed' ? 'closed' : 'open',
      isDraft: pull.draft === true,
      isFromFork: headRepo === null || headRepo.toLowerCase() !== repoPath.toLowerCase(),
      headSha: pull.head?.sha ?? '',
      createdAt: toUnix(pull.created_at),
      updatedAt: toUnix(pull.updated_at),
    };
  };

  return {
    kind: 'github',
    label: 'GitHub',
    async listOpenPullRequests(): Promise<PullRequestInfo[]> {
      const data = (await request(
        'GET',
        `/repos/${repoPath}/pulls?state=open&sort=updated&direction=desc&per_page=50`,
      )) as GithubPull[];
      if (!Array.isArray(data)) throw new ForgeError('GitHub returned an unexpected response', 'github');
      return data.map(mapPull);
    },
    async defaultBranch(): Promise<string> {
      const data = (await request('GET', `/repos/${repoPath}`)) as { default_branch?: string };
      return data.default_branch ?? 'main';
    },
    async listReviewerCandidates(): Promise<ForgeUser[]> {
      const data = (await request(
        'GET',
        `/repos/${repoPath}/collaborators?per_page=100`,
      )) as Array<{ login?: string; name?: string | null; avatar_url?: string }>;
      if (!Array.isArray(data)) return [];
      return data
        .filter((user) => user.login)
        .map((user) => ({
          id: user.login as string,
          username: user.login as string,
          name: user.name ?? (user.login as string),
          avatarUrl: user.avatar_url ?? null,
        }));
    },
    async createPullRequest(input: CreatePullRequestInput): Promise<PullRequestInfo> {
      const data = (await request('POST', `/repos/${repoPath}/pulls`, {
        title: input.title,
        head: input.sourceBranch,
        base: input.targetBranch,
        body: input.body,
        draft: input.draft,
      })) as GithubPull;
      const pr = mapPull(data);
      if (input.reviewerIds?.length) {
        try {
          await request('POST', `/repos/${repoPath}/pulls/${pr.number}/requested_reviewers`, {
            reviewers: input.reviewerIds,
          });
        } catch {
          return pr;
        }
      }
      return pr;
    },
    checkoutSpec(pr: PullRequestInfo): PullRequestCheckoutSpec {
      if (pr.isFromFork || !pr.sourceBranch) {
        return { sourceRef: `refs/pull/${pr.number}/head`, localBranch: `pr/${pr.number}`, track: false };
      }
      return { sourceRef: `refs/heads/${pr.sourceBranch}`, localBranch: pr.sourceBranch, track: true };
    },
  };
}
