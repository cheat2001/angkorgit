import { describe, expect, it } from 'vitest';
import {
  ForgeError,
  bitbucketForgeProvider,
  createForgeProvider,
  githubApiBase,
  githubForgeProvider,
  gitlabForgeProvider,
  parseForgeRemote,
  pickForgeRemote,
  type HttpRequest,
  type HttpResponse,
} from '@angkorgit/core';

function fakeHttp(handler: (request: HttpRequest) => HttpResponse) {
  const calls: HttpRequest[] = [];
  const http = async (request: HttpRequest): Promise<HttpResponse> => {
    calls.push(request);
    return handler(request);
  };
  return { http, calls };
}

const githubRemote = () => {
  const remote = parseForgeRemote('git@github.com:cheat2001/angkorgit.git');
  if (!remote) throw new Error('expected a parsed remote');
  return remote;
};

const samplePull = (overrides: Record<string, unknown> = {}) => ({
  number: 12,
  title: 'Add worktrees',
  html_url: 'https://github.com/cheat2001/angkorgit/pull/12',
  state: 'open',
  draft: false,
  merged_at: null,
  created_at: '2026-08-20T10:00:00Z',
  updated_at: '2026-08-21T11:30:00Z',
  user: { login: 'dara', avatar_url: 'https://avatars.example/dara' },
  head: { ref: 'feature/worktrees', sha: 'abc123', repo: { full_name: 'cheat2001/angkorgit' } },
  base: { ref: 'main' },
  ...overrides,
});

describe('parseForgeRemote', () => {
  it('parses github https, scp and ssh remotes', () => {
    for (const url of [
      'https://github.com/cheat2001/angkorgit.git',
      'git@github.com:cheat2001/angkorgit.git',
      'ssh://git@github.com/cheat2001/angkorgit',
    ]) {
      const remote = parseForgeRemote(url);
      expect(remote?.kind).toBe('github');
      expect(remote?.host).toBe('github.com');
      expect(remote?.owner).toBe('cheat2001');
      expect(remote?.repo).toBe('angkorgit');
    }
  });

  it('rejects github paths that are not owner/repo', () => {
    expect(parseForgeRemote('https://github.com/cheat2001')).toBeNull();
    expect(parseForgeRemote('https://github.com/a/b/c')).toBeNull();
  });

  it('parses gitlab subgroups into the owner', () => {
    const remote = parseForgeRemote('git@gitlab.example.com:group/subgroup/project.git');
    expect(remote?.kind).toBe('gitlab');
    expect(remote?.owner).toBe('group/subgroup');
    expect(remote?.repo).toBe('project');
  });

  it('parses bitbucket cloud and server shapes', () => {
    const cloud = parseForgeRemote('git@bitbucket.org:team/repo.git');
    expect(cloud?.kind).toBe('bitbucket');
    expect(cloud?.owner).toBe('team');
    const server = parseForgeRemote('https://bitbucket.corp.dev/scm/PROJ/repo.git');
    expect(server?.kind).toBe('bitbucket');
    expect(server?.owner).toBe('PROJ');
    expect(server?.repo).toBe('repo');
  });

  it('returns null for unknown forges and non-remote strings', () => {
    expect(parseForgeRemote('git@git.sr.ht:~user/repo')).toBeNull();
    expect(parseForgeRemote('not a url')).toBeNull();
  });
});

describe('createForgeProvider', () => {
  it('creates providers for github, gitlab and bitbucket cloud', () => {
    const { http } = fakeHttp(() => ({ status: 200, body: '[]' }));
    expect(createForgeProvider(githubRemote(), http)?.kind).toBe('github');
    const gitlab = parseForgeRemote('git@gitlab.com:group/project.git');
    expect(gitlab && createForgeProvider(gitlab, http)?.kind).toBe('gitlab');
    const cloud = parseForgeRemote('git@bitbucket.org:team/repo.git');
    expect(cloud && createForgeProvider(cloud, http)?.kind).toBe('bitbucket');
  });

  it('has no api provider for bitbucket server', () => {
    const { http } = fakeHttp(() => ({ status: 200, body: '[]' }));
    const server = parseForgeRemote('https://bitbucket.corp.dev/scm/PROJ/repo.git');
    expect(server && createForgeProvider(server, http)).toBeNull();
  });
});

describe('githubForgeProvider', () => {
  it('uses api.github.com for github.com and /api/v3 for enterprise hosts', () => {
    expect(githubApiBase('github.com')).toBe('https://api.github.com');
    expect(githubApiBase('github.corp.dev:8443')).toBe('https://github.corp.dev:8443/api/v3');
  });

  it('lists open pull requests with mapped fields', async () => {
    const { http, calls } = fakeHttp(() => ({
      status: 200,
      body: JSON.stringify([
        samplePull(),
        samplePull({
          number: 13,
          draft: true,
          head: { ref: 'fix/typo', sha: 'def456', repo: { full_name: 'someone/angkorgit' } },
        }),
        samplePull({ number: 14, head: { ref: 'gone', sha: 'ffff00', repo: null } }),
      ]),
    }));
    const prs = await githubForgeProvider(githubRemote(), http).listOpenPullRequests();
    expect(calls[0].url).toBe(
      'https://api.github.com/repos/cheat2001/angkorgit/pulls?state=open&sort=updated&direction=desc&per_page=50',
    );
    expect(prs).toHaveLength(3);
    expect(prs[0]).toMatchObject({
      number: 12,
      title: 'Add worktrees',
      author: 'dara',
      sourceBranch: 'feature/worktrees',
      targetBranch: 'main',
      state: 'open',
      isDraft: false,
      isFromFork: false,
    });
    expect(prs[0].updatedAt).toBe(Math.floor(Date.parse('2026-08-21T11:30:00Z') / 1000));
    expect(prs[1].isDraft).toBe(true);
    expect(prs[1].isFromFork).toBe(true);
    expect(prs[2].isFromFork).toBe(true);
  });

  it('creates a pull request and returns the mapped result', async () => {
    const { http, calls } = fakeHttp(() => ({
      status: 201,
      body: JSON.stringify(samplePull({ number: 21, title: 'New feature' })),
    }));
    const created = await githubForgeProvider(githubRemote(), http).createPullRequest({
      title: 'New feature',
      body: 'Adds the thing.',
      sourceBranch: 'feature/thing',
      targetBranch: 'main',
      draft: true,
    });
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toBe('https://api.github.com/repos/cheat2001/angkorgit/pulls');
    expect(JSON.parse(calls[0].body ?? '{}')).toEqual({
      title: 'New feature',
      head: 'feature/thing',
      base: 'main',
      body: 'Adds the thing.',
      draft: true,
    });
    expect(created.number).toBe(21);
  });

  it('surfaces github error messages with the status', async () => {
    const { http } = fakeHttp(() => ({
      status: 422,
      body: JSON.stringify({
        message: 'Validation Failed',
        errors: [{ message: 'A pull request already exists for feature/thing.' }],
      }),
    }));
    await expect(
      githubForgeProvider(githubRemote(), http).listOpenPullRequests(),
    ).rejects.toMatchObject({
      name: 'ForgeError',
      status: 422,
      message: expect.stringContaining('A pull request already exists'),
    } satisfies Partial<ForgeError> & { message: unknown });
  });

  it('reads the default branch with a fallback', async () => {
    const { http } = fakeHttp((request) => ({
      status: 200,
      body: request.url.endsWith('/repos/cheat2001/angkorgit')
        ? JSON.stringify({ default_branch: 'develop' })
        : '{}',
    }));
    await expect(githubForgeProvider(githubRemote(), http).defaultBranch()).resolves.toBe('develop');
  });

  it('checks out same-repo branches with tracking and fork PRs via refs/pull', async () => {
    const { http } = fakeHttp(() => ({ status: 200, body: '[]' }));
    const provider = githubForgeProvider(githubRemote(), http);
    const base = {
      number: 12,
      title: 't',
      author: 'a',
      authorAvatarUrl: null,
      sourceBranch: 'feature/worktrees',
      targetBranch: 'main',
      url: '',
      state: 'open' as const,
      isDraft: false,
      headSha: '',
      createdAt: 0,
      updatedAt: 0,
    };
    expect(provider.checkoutSpec({ ...base, isFromFork: false })).toEqual({
      sourceRef: 'refs/heads/feature/worktrees',
      localBranch: 'feature/worktrees',
      track: true,
    });
    expect(provider.checkoutSpec({ ...base, isFromFork: true })).toEqual({
      sourceRef: 'refs/pull/12/head',
      localBranch: 'pr/12',
      track: false,
    });
  });
});

describe('gitlabForgeProvider', () => {
  const gitlabRemote = () => {
    const remote = parseForgeRemote('git@gitlab.example.com:group/subgroup/project.git');
    if (!remote) throw new Error('expected a parsed remote');
    return remote;
  };

  const sampleMr = (overrides: Record<string, unknown> = {}) => ({
    iid: 7,
    title: 'Fix pipeline',
    web_url: 'https://gitlab.example.com/group/subgroup/project/-/merge_requests/7',
    state: 'opened',
    draft: false,
    sha: 'abc999',
    created_at: '2026-08-20T10:00:00Z',
    updated_at: '2026-08-21T11:30:00Z',
    author: { username: 'maly', avatar_url: 'https://gitlab.example.com/a.png' },
    source_branch: 'fix/pipeline',
    target_branch: 'main',
    source_project_id: 42,
    target_project_id: 42,
    ...overrides,
  });

  it('lists merge requests through the url-encoded project path', async () => {
    const { http, calls } = fakeHttp(() => ({
      status: 200,
      body: JSON.stringify([sampleMr(), sampleMr({ iid: 8, source_project_id: 99 })]),
    }));
    const prs = await gitlabForgeProvider(gitlabRemote(), http).listOpenPullRequests();
    expect(calls[0].url).toBe(
      'https://gitlab.example.com/api/v4/projects/group%2Fsubgroup%2Fproject/merge_requests?state=opened&order_by=updated_at&sort=desc&per_page=50',
    );
    expect(prs[0]).toMatchObject({
      number: 7,
      author: 'maly',
      sourceBranch: 'fix/pipeline',
      state: 'open',
      isFromFork: false,
    });
    expect(prs[1].isFromFork).toBe(true);
  });

  it('creates a merge request with a draft title prefix', async () => {
    const { http, calls } = fakeHttp(() => ({ status: 201, body: JSON.stringify(sampleMr()) }));
    await gitlabForgeProvider(gitlabRemote(), http).createPullRequest({
      title: 'Fix pipeline',
      body: 'Details',
      sourceBranch: 'fix/pipeline',
      targetBranch: 'main',
      draft: true,
    });
    expect(JSON.parse(calls[0].body ?? '{}')).toEqual({
      title: 'Draft: Fix pipeline',
      description: 'Details',
      source_branch: 'fix/pipeline',
      target_branch: 'main',
    });
  });

  it('surfaces gitlab array error messages', async () => {
    const { http } = fakeHttp(() => ({
      status: 409,
      body: JSON.stringify({ message: ['Another open merge request already exists'] }),
    }));
    await expect(
      gitlabForgeProvider(gitlabRemote(), http).listOpenPullRequests(),
    ).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('Another open merge request'),
    });
  });

  it('checks out fork merge requests via refs/merge-requests', () => {
    const { http } = fakeHttp(() => ({ status: 200, body: '[]' }));
    const provider = gitlabForgeProvider(gitlabRemote(), http);
    const pr = {
      number: 7,
      title: 't',
      author: 'a',
      authorAvatarUrl: null,
      sourceBranch: 'fix/pipeline',
      targetBranch: 'main',
      url: '',
      state: 'open' as const,
      isDraft: false,
      isFromFork: true,
      headSha: '',
      createdAt: 0,
      updatedAt: 0,
    };
    expect(provider.checkoutSpec(pr)).toEqual({
      sourceRef: 'refs/merge-requests/7/head',
      localBranch: 'mr/7',
      track: false,
    });
    expect(provider.checkoutSpec({ ...pr, isFromFork: false })).toEqual({
      sourceRef: 'refs/heads/fix/pipeline',
      localBranch: 'fix/pipeline',
      track: true,
    });
  });
});

describe('bitbucketForgeProvider', () => {
  const bitbucketRemote = () => {
    const remote = parseForgeRemote('git@bitbucket.org:team/repo.git');
    if (!remote) throw new Error('expected a parsed remote');
    return remote;
  };

  const samplePr = (overrides: Record<string, unknown> = {}) => ({
    id: 3,
    title: 'Update docs',
    state: 'OPEN',
    created_on: '2026-08-20T10:00:00Z',
    updated_on: '2026-08-21T11:30:00Z',
    author: { display_name: 'Sokha Chan', nickname: 'sokha', links: { avatar: { href: 'https://bb/a.png' } } },
    source: { branch: { name: 'docs/update' }, commit: { hash: 'ff00aa' }, repository: { full_name: 'team/repo' } },
    destination: { branch: { name: 'main' } },
    links: { html: { href: 'https://bitbucket.org/team/repo/pull-requests/3' } },
    ...overrides,
  });

  it('lists open pull requests from the values envelope', async () => {
    const { http, calls } = fakeHttp(() => ({
      status: 200,
      body: JSON.stringify({ values: [samplePr()] }),
    }));
    const prs = await bitbucketForgeProvider(bitbucketRemote(), http).listOpenPullRequests();
    expect(calls[0].url).toBe(
      'https://api.bitbucket.org/2.0/repositories/team/repo/pullrequests?state=OPEN&sort=-updated_on&pagelen=50',
    );
    expect(prs[0]).toMatchObject({
      number: 3,
      author: 'sokha',
      sourceBranch: 'docs/update',
      targetBranch: 'main',
      state: 'open',
      isFromFork: false,
    });
  });

  it('creates a pull request with source and destination branches', async () => {
    const { http, calls } = fakeHttp(() => ({ status: 201, body: JSON.stringify(samplePr()) }));
    await bitbucketForgeProvider(bitbucketRemote(), http).createPullRequest({
      title: 'Update docs',
      body: 'Details',
      sourceBranch: 'docs/update',
      targetBranch: 'main',
      draft: false,
    });
    expect(JSON.parse(calls[0].body ?? '{}')).toEqual({
      title: 'Update docs',
      description: 'Details',
      source: { branch: { name: 'docs/update' } },
      destination: { branch: { name: 'main' } },
    });
  });

  it('surfaces bitbucket error messages', async () => {
    const { http } = fakeHttp(() => ({
      status: 400,
      body: JSON.stringify({ error: { message: 'source branch not found' } }),
    }));
    await expect(
      bitbucketForgeProvider(bitbucketRemote(), http).listOpenPullRequests(),
    ).rejects.toMatchObject({ status: 400, message: expect.stringContaining('source branch not found') });
  });

  it('tracks same-repo branches and has no checkout for fork pull requests', () => {
    const { http } = fakeHttp(() => ({ status: 200, body: '{}' }));
    const provider = bitbucketForgeProvider(bitbucketRemote(), http);
    const pr = {
      number: 3,
      title: 't',
      author: 'a',
      authorAvatarUrl: null,
      sourceBranch: 'docs/update',
      targetBranch: 'main',
      url: '',
      state: 'open' as const,
      isDraft: false,
      isFromFork: false,
      headSha: '',
      createdAt: 0,
      updatedAt: 0,
    };
    expect(provider.checkoutSpec(pr)).toEqual({
      sourceRef: 'refs/heads/docs/update',
      localBranch: 'docs/update',
      track: true,
    });
    expect(provider.checkoutSpec({ ...pr, isFromFork: true })).toBeNull();
  });
});

describe('pickForgeRemote', () => {
  const remotes = [
    { name: 'github', url: 'git@github.com:me/test.git' },
    { name: 'origin', url: 'git@bitbucket.org:team/test.git' },
  ];

  it('prefers the remote of the current branch upstream', () => {
    expect(pickForgeRemote(remotes, 'github/feature/test1')?.name).toBe('github');
    expect(pickForgeRemote(remotes, 'origin/feature/test1')?.name).toBe('origin');
  });

  it('falls back to origin, then the first remote', () => {
    expect(pickForgeRemote(remotes, null)?.name).toBe('origin');
    expect(pickForgeRemote(remotes, 'gone/branch')?.name).toBe('origin');
    expect(pickForgeRemote([remotes[0]], null)?.name).toBe('github');
    expect(pickForgeRemote([], null)).toBeNull();
  });
});

describe('github validation errors', () => {
  it('spells out field-level errors that carry no message', async () => {
    const { http } = fakeHttp(() => ({
      status: 422,
      body: JSON.stringify({
        message: 'Validation Failed',
        errors: [{ resource: 'PullRequest', field: 'head', code: 'invalid' }],
      }),
    }));
    await expect(
      githubForgeProvider(githubRemote(), http).createPullRequest({
        title: 't',
        body: '',
        sourceBranch: 'feature/x',
        targetBranch: 'main',
        draft: false,
      }),
    ).rejects.toMatchObject({
      message: expect.stringContaining('the source branch does not exist on this remote'),
    });
  });
});

describe('gitlab self-hosted scheme fallback', () => {
  it('retries over http when the https transport fails on a self-hosted instance', async () => {
    const calls: HttpRequest[] = [];
    const http = async (request: HttpRequest): Promise<HttpResponse> => {
      calls.push(request);
      if (request.url.startsWith('https://')) {
        throw new Error('request failed: error sending request for url');
      }
      return { status: 200, body: '[]' };
    };
    const remote = parseForgeRemote('git@gitlab-01.remotes.local:products/wl/monika.git');
    if (!remote) throw new Error('expected a parsed remote');
    const prs = await gitlabForgeProvider(remote, http).listOpenPullRequests();
    expect(prs).toEqual([]);
    expect(calls[0].url.startsWith('https://gitlab-01.remotes.local/api/v4/')).toBe(true);
    expect(calls[1].url.startsWith('http://gitlab-01.remotes.local/api/v4/')).toBe(true);
  });

  it('never falls back to http for gitlab.com or on api-level errors', async () => {
    const attempted: string[] = [];
    const failing = async (request: HttpRequest): Promise<HttpResponse> => {
      attempted.push(request.url);
      throw new Error('request failed: error sending request for url');
    };
    const cloud = parseForgeRemote('git@gitlab.com:group/project.git');
    if (!cloud) throw new Error('expected a parsed remote');
    await expect(gitlabForgeProvider(cloud, failing).listOpenPullRequests()).rejects.toThrow();
    expect(attempted).toHaveLength(1);

    const apiError = async (): Promise<HttpResponse> => ({
      status: 401,
      body: JSON.stringify({ message: '401 Unauthorized' }),
    });
    const selfHosted = parseForgeRemote('git@gitlab.example.com:group/project.git');
    if (!selfHosted) throw new Error('expected a parsed remote');
    await expect(
      gitlabForgeProvider(selfHosted, apiError).listOpenPullRequests(),
    ).rejects.toMatchObject({ status: 401 });
  });
});

describe('reviewer candidates and requests', () => {
  it('github lists collaborators and requests reviewers after creating', async () => {
    const { http, calls } = fakeHttp((request) => {
      if (request.url.includes('/collaborators')) {
        return {
          status: 200,
          body: JSON.stringify([
            { login: 'dara', name: 'Dara Kim', avatar_url: 'https://a/dara' },
            { login: 'maly' },
          ]),
        };
      }
      if (request.url.endsWith('/requested_reviewers')) {
        return { status: 201, body: JSON.stringify(samplePull()) };
      }
      return { status: 201, body: JSON.stringify(samplePull({ number: 30 })) };
    });
    const provider = githubForgeProvider(githubRemote(), http);
    const users = await provider.listReviewerCandidates();
    expect(users).toEqual([
      { id: 'dara', username: 'dara', name: 'Dara Kim', avatarUrl: 'https://a/dara' },
      { id: 'maly', username: 'maly', name: 'maly', avatarUrl: null },
    ]);
    const pr = await provider.createPullRequest({
      title: 't',
      body: '',
      sourceBranch: 'feature/x',
      targetBranch: 'main',
      draft: false,
      reviewerIds: ['dara'],
    });
    expect(pr.number).toBe(30);
    const reviewerCall = calls.find((c) => c.url.endsWith('/pulls/30/requested_reviewers'));
    expect(reviewerCall?.method).toBe('POST');
    expect(JSON.parse(reviewerCall?.body ?? '{}')).toEqual({ reviewers: ['dara'] });
  });

  it('github still returns the created pr when the reviewer request fails', async () => {
    const { http } = fakeHttp((request) => {
      if (request.url.endsWith('/requested_reviewers')) {
        return { status: 422, body: JSON.stringify({ message: 'Reviews may not be requested' }) };
      }
      return { status: 201, body: JSON.stringify(samplePull({ number: 31 })) };
    });
    const pr = await githubForgeProvider(githubRemote(), http).createPullRequest({
      title: 't',
      body: '',
      sourceBranch: 'feature/x',
      targetBranch: 'main',
      draft: false,
      reviewerIds: ['dara'],
    });
    expect(pr.number).toBe(31);
  });

  it('gitlab lists project members and embeds reviewer_ids on create', async () => {
    const remote = parseForgeRemote('git@gitlab.example.com:group/project.git');
    if (!remote) throw new Error('expected a parsed remote');
    const { http, calls } = fakeHttp((request) => {
      if (request.url.includes('/members/all')) {
        return {
          status: 200,
          body: JSON.stringify([
            { id: 5, username: 'maly', name: 'Maly Sok', avatar_url: 'https://a/maly', state: 'active' },
            { id: 6, username: 'gone', name: 'Blocked', state: 'blocked' },
          ]),
        };
      }
      return {
        status: 201,
        body: JSON.stringify({ iid: 9, title: 't', state: 'opened' }),
      };
    });
    const provider = gitlabForgeProvider(remote, http);
    const users = await provider.listReviewerCandidates();
    expect(users).toEqual([
      { id: '5', username: 'maly', name: 'Maly Sok', avatarUrl: 'https://a/maly' },
    ]);
    await provider.createPullRequest({
      title: 't',
      body: '',
      sourceBranch: 'f',
      targetBranch: 'main',
      draft: false,
      reviewerIds: ['5'],
    });
    const createCall = calls.find((c) => c.method === 'POST');
    expect(JSON.parse(createCall?.body ?? '{}').reviewer_ids).toEqual([5]);
  });

  it('bitbucket lists workspace members and embeds reviewer uuids on create', async () => {
    const remote = parseForgeRemote('git@bitbucket.org:team/repo.git');
    if (!remote) throw new Error('expected a parsed remote');
    const { http, calls } = fakeHttp((request) => {
      if (request.url.includes('/workspaces/team/members')) {
        return {
          status: 200,
          body: JSON.stringify({
            values: [
              {
                user: {
                  uuid: '{u-1}',
                  nickname: 'sokha',
                  display_name: 'Sokha Chan',
                  links: { avatar: { href: 'https://a/s' } },
                },
              },
            ],
          }),
        };
      }
      return {
        status: 201,
        body: JSON.stringify({ id: 4, title: 't', state: 'OPEN' }),
      };
    });
    const provider = bitbucketForgeProvider(remote, http);
    const users = await provider.listReviewerCandidates();
    expect(users).toEqual([
      { id: '{u-1}', username: 'sokha', name: 'Sokha Chan', avatarUrl: 'https://a/s' },
    ]);
    await provider.createPullRequest({
      title: 't',
      body: '',
      sourceBranch: 'f',
      targetBranch: 'main',
      draft: false,
      reviewerIds: ['{u-1}'],
    });
    const createCall = calls.find((c) => c.method === 'POST');
    expect(JSON.parse(createCall?.body ?? '{}').reviewers).toEqual([{ uuid: '{u-1}' }]);
  });
});
