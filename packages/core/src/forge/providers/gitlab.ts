import type { HttpClient } from '../../ai/types';
import type { ForgeRemote } from '../remote';
import type { ForgeProvider } from '../provider';
import { createForgeJsonRequest, pullRequestCheckoutSpec, toUnix } from '../shared';
import {
  ForgeError,
  type CreatePullRequestInput,
  type ForgeUser,
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

function gitlabMessage(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { message?: string | string[]; error?: string };
    if (Array.isArray(parsed.message)) return parsed.message.join('; ');
    return parsed.message ?? parsed.error ?? null;
  } catch {
    return null;
  }
}

const workingBaseByHost = new Map<string, number>();

export function gitlabForgeProvider(remote: ForgeRemote, http: HttpClient): ForgeProvider {
  const projectId = encodeURIComponent(`${remote.owner}/${remote.repo}`);
  const bases = [`${remote.scheme}://${remote.host}/api/v4`];
  if (remote.scheme === 'https' && remote.host.split(':')[0] !== 'gitlab.com') {
    bases.push(`http://${remote.host}/api/v4`);
  }
  const baseIndex = () => Math.min(workingBaseByHost.get(remote.host) ?? 0, bases.length - 1);

  const requestJson = createForgeJsonRequest(http, 'gitlab', 'GitLab', gitlabMessage);

  const request = async (method: 'GET' | 'POST', path: string, payload?: unknown): Promise<unknown> => {
    const index = baseIndex();
    try {
      return await requestJson(`${bases[index]}${path}`, method, payload);
    } catch (error) {
      if (error instanceof ForgeError || method !== 'GET' || index + 1 >= bases.length) throw error;
      const result = await requestJson(`${bases[index + 1]}${path}`, method, payload);
      workingBaseByHost.set(remote.host, index + 1);
      return result;
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
    async listReviewerCandidates(): Promise<ForgeUser[]> {
      const data = (await request(
        'GET',
        `/projects/${projectId}/members/all?per_page=100`,
      )) as Array<{ id?: number; username?: string; name?: string; avatar_url?: string; state?: string }>;
      if (!Array.isArray(data)) return [];
      return data
        .filter((user) => user.id !== undefined && user.username && user.state !== 'blocked')
        .map((user) => ({
          id: String(user.id),
          username: user.username as string,
          name: user.name ?? (user.username as string),
          avatarUrl: user.avatar_url ?? null,
        }));
    },
    async createPullRequest(input: CreatePullRequestInput): Promise<PullRequestInfo> {
      const title = input.draft && !/^draft:/i.test(input.title) ? `Draft: ${input.title}` : input.title;
      const reviewerIds = (input.reviewerIds ?? [])
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id));
      const data = (await request('POST', `/projects/${projectId}/merge_requests`, {
        title,
        description: input.body,
        source_branch: input.sourceBranch,
        target_branch: input.targetBranch,
        ...(reviewerIds.length ? { reviewer_ids: reviewerIds } : {}),
      })) as GitlabMergeRequest;
      return mapMergeRequest(data);
    },
    checkoutSpec(pr: PullRequestInfo): PullRequestCheckoutSpec | null {
      return pullRequestCheckoutSpec('gitlab', pr);
    },
  };
}
