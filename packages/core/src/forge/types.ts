export type PullRequestState = 'open' | 'closed' | 'merged';

export interface PullRequestInfo {
  number: number;
  title: string;
  author: string;
  authorAvatarUrl: string | null;
  sourceBranch: string;
  targetBranch: string;
  url: string;
  state: PullRequestState;
  isDraft: boolean;
  isFromFork: boolean;
  headSha: string;
  createdAt: number;
  updatedAt: number;
}

export interface CreatePullRequestInput {
  title: string;
  body: string;
  sourceBranch: string;
  targetBranch: string;
  draft: boolean;
}

export interface PullRequestCheckoutSpec {
  sourceRef: string;
  localBranch: string;
  track: boolean;
}

export class ForgeError extends Error {
  constructor(
    message: string,
    public readonly forge: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'ForgeError';
  }
}
