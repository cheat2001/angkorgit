import type { HttpClient } from '../../ai/types';
import type { ForgeRemote } from '../remote';
import type { ForgeProvider } from '../provider';
import {
  ForgeError,
  type CreatePullRequestInput,
  type PullRequestCheckoutSpec,
  type PullRequestInfo,
} from '../types';

interface GitlabMergeRequest {
  iid: number;
  title?: string;
  web_url?: string;
  state?: string;
  draft?: boolean;
  work_in_progress?: boolean;
  sha?: string;
  created_at?: string;
  updated_at?: string;
  author?: { username?: string; avatar_url?: string } | null;
  source_branch?: string;
  target_branch?: string;
  source_project_id?: number;
  target_project_id?: number;
}

function toUnix(iso: string | undefined): number {
  const ms = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0;
}

function gitlabMessage(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { message?: string | string[]; error?: string };
    if (Array.isArray(parsed.message)) return parsed.message.join('; ');
    return parsed.message ?? parsed.error ?? null;
  } catch {
    return null;
  }
}

export function gitlabForgeProvider(remote: ForgeRemote, http: HttpClient): ForgeProvider {
  const apiBase = `${remote.scheme}://${remote.host}/api/v4`;
  const projectId = encodeURIComponent(`${remote.owner}/${remote.repo}`);

  const request = async (method: 'GET' | 'POST', path: string, payload?: unknown): Promise<unknown> => {
    const res = await http({
      url: `${apiBase}${path}`,
      method,
      headers: payload === undefined ? {} : { 'content-type': 'application/json' },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
    if (res.status < 200 || res.status >= 300) {
      const detail = gitlabMessage(res.body);
      throw new ForgeError(
        `GitLab request failed (${res.status})${detail ? `: ${detail}` : ''}`,
        'gitlab',
        res.status,
      );
    }
    try {
      return JSON.parse(res.body);
    } catch {
      throw new ForgeError('GitLab returned invalid JSON', 'gitlab');
    }
  };

  const mapMergeRequest = (mr: GitlabMergeRequest): PullRequestInfo => ({
    number: mr.iid,
    title: mr.title ?? `!${mr.iid}`,
    author: mr.author?.username ?? 'unknown',
    authorAvatarUrl: mr.author?.avatar_url ?? null,
    sourceBranch: mr.source_branch ?? '',
    targetBranch: mr.target_branch ?? '',
    url: mr.web_url ?? remote.webUrl,
    state: mr.state === 'merged' ? 'merged' : mr.state === 'closed' ? 'closed' : 'open',
    isDraft: mr.draft === true || mr.work_in_progress === true,
    isFromFork:
      mr.source_project_id !== undefined &&
      mr.target_project_id !== undefined &&
      mr.source_project_id !== mr.target_project_id,
    headSha: mr.sha ?? '',
    createdAt: toUnix(mr.created_at),
    updatedAt: toUnix(mr.updated_at),
  });

  return {
    kind: 'gitlab',
    label: 'GitLab',
    async listOpenPullRequests(): Promise<PullRequestInfo[]> {
      const data = (await request(
        'GET',
        `/projects/${projectId}/merge_requests?state=opened&order_by=updated_at&sort=desc&per_page=50`,
      )) as GitlabMergeRequest[];
      if (!Array.isArray(data)) throw new ForgeError('GitLab returned an unexpected response', 'gitlab');
      return data.map(mapMergeRequest);
    },
    async defaultBranch(): Promise<string> {
      const data = (await request('GET', `/projects/${projectId}`)) as { default_branch?: string };
      return data.default_branch ?? 'main';
    },
    async createPullRequest(input: CreatePullRequestInput): Promise<PullRequestInfo> {
      const title = input.draft && !/^draft:/i.test(input.title) ? `Draft: ${input.title}` : input.title;
      const data = (await request('POST', `/projects/${projectId}/merge_requests`, {
        title,
        description: input.body,
        source_branch: input.sourceBranch,
        target_branch: input.targetBranch,
      })) as GitlabMergeRequest;
      return mapMergeRequest(data);
    },
    checkoutSpec(pr: PullRequestInfo): PullRequestCheckoutSpec {
      if (pr.isFromFork || !pr.sourceBranch) {
        return {
          sourceRef: `refs/merge-requests/${pr.number}/head`,
          localBranch: `mr/${pr.number}`,
          track: false,
        };
      }
      return { sourceRef: `refs/heads/${pr.sourceBranch}`, localBranch: pr.sourceBranch, track: true };
    },
  };
}
