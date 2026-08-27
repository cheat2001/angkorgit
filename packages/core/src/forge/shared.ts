import type { HttpClient } from '../ai/types';
import type { ForgeKind } from './remote';
import { ForgeError, type PullRequestCheckoutSpec, type PullRequestInfo } from './types';

export type ForgeJsonRequest = (
  url: string,
  method: 'GET' | 'POST',
  payload?: unknown,
) => Promise<unknown>;

export function createForgeJsonRequest(
  http: HttpClient,
  forge: string,
  label: string,
  parseMessage: (body: string) => string | null,
): ForgeJsonRequest {
  return async (url, method, payload) => {
    const res = await http({
      url,
      method,
      headers: payload === undefined ? {} : { 'content-type': 'application/json' },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
    if (res.status < 200 || res.status >= 300) {
      const detail = parseMessage(res.body);
      throw new ForgeError(
        `${label} request failed (${res.status})${detail ? `: ${detail}` : ''}`,
        forge,
        res.status,
      );
    }
    try {
      return JSON.parse(res.body);
    } catch {
      throw new ForgeError(`${label} returned invalid JSON`, forge);
    }
  };
}

export function toUnix(iso: string | undefined): number {
  const ms = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0;
}

export function forgeNoun(
  kind: ForgeKind | null | undefined,
  options: { plural?: boolean; capitalize?: boolean } = {},
): string {
  const base = kind === 'gitlab' ? 'merge request' : 'pull request';
  const word = options.plural ? `${base}s` : base;
  return options.capitalize ? word.charAt(0).toUpperCase() + word.slice(1) : word;
}

export function pullRequestCheckoutSpec(
  kind: ForgeKind,
  pr: PullRequestInfo,
): PullRequestCheckoutSpec | null {
  if (!pr.isFromFork && pr.sourceBranch) {
    return { sourceRef: `refs/heads/${pr.sourceBranch}`, localBranch: pr.sourceBranch, track: true };
  }
  switch (kind) {
    case 'github':
      return { sourceRef: `refs/pull/${pr.number}/head`, localBranch: `pr/${pr.number}`, track: false };
    case 'gitlab':
      return {
        sourceRef: `refs/merge-requests/${pr.number}/head`,
        localBranch: `mr/${pr.number}`,
        track: false,
      };
    case 'bitbucket':
    case 'bitbucket-server':
      return null;
  }
}
