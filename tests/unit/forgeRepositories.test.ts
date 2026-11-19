import { describe, expect, it, vi } from 'vitest';
import type { HttpClient, HttpResponse } from '@angkorgit/core';
import { listAccountRepositories } from '@angkorgit/core';

function response(body: unknown, headers: Partial<HttpResponse> = {}): HttpResponse {
  return { status: 200, body: JSON.stringify(body), ...headers };
}

describe('saved account repository pages', () => {
  it('builds GitHub Enterprise URLs from repository names and reports invalid entries', async () => {
    const http = vi.fn<HttpClient>().mockResolvedValue(
      response([
        { full_name: 'team/repo', clone_url: 'https://public.example.test/team/repo.git' },
        { full_name: 'team/../invalid' },
        { clone_url: 'https://other.example.test/repo.git' },
      ], { link: '<https://git.internal.test:8443/api/v3/user/repos?page=2>; rel="next"' }),
    );
    const result = await listAccountRepositories({ host: 'git.internal.test:8443', provider: 'github' }, http);
    expect(result).toEqual({
      repositories: [{ fullName: 'team/repo', cloneUrl: 'https://git.internal.test:8443/team/repo.git' }],
      next: { kind: 'github', url: 'https://git.internal.test:8443/api/v3/user/repos?page=2' },
      skipped: 2,
    });
    expect(http).toHaveBeenCalledTimes(1);
  });

  it('keeps the saved GitLab host and filters when a proxy advertises a different origin', async () => {
    const http = vi.fn<HttpClient>()
      .mockResolvedValueOnce(response([{ path_with_namespace: 'group/subgroup/project' }], {
        link: '<http://proxy.example.test/other/projects?membership=false&page=2>; rel="next"',
      }))
      .mockResolvedValueOnce(response([{ path_with_namespace: 'group/new-project' }]));
    const account = { host: 'git.internal.test:8443', provider: 'gitlab-self' };
    const result = await listAccountRepositories(account, http);
    expect(result.repositories[0]?.cloneUrl).toBe('https://git.internal.test:8443/group/subgroup/project.git');
    expect(http).toHaveBeenCalledTimes(1);
    await listAccountRepositories(account, http, result.next);
    expect(http.mock.calls[1]?.[0].url).toBe(
      'https://git.internal.test:8443/api/v4/projects?membership=true&simple=true&per_page=50&order_by=id&sort=asc&page=2',
    );
  });

  it('loads one Bitbucket repository page at a time and retains pending workspaces', async () => {
    const http = vi.fn<HttpClient>()
      .mockResolvedValueOnce(response({ values: [{ workspace: { slug: 'alpha' } }, { workspace: { slug: 'beta' } }] }))
      .mockResolvedValueOnce(response({
        values: [{ repository: { full_name: 'alpha/first' } }],
        next: '?pagelen=50&page=2',
      }))
      .mockResolvedValueOnce(response({ values: [{ repository: { full_name: 'alpha/second' } }] }))
      .mockResolvedValueOnce(response({ values: [{ repository: { full_name: 'beta/third' } }] }));
    const account = { host: 'bitbucket.org', provider: 'bitbucket' };
    const first = await listAccountRepositories(account, http);
    expect(first.repositories[0]?.fullName).toBe('alpha/first');
    expect(http).toHaveBeenCalledTimes(2);
    const second = await listAccountRepositories(account, http, first.next);
    expect(second.repositories[0]?.fullName).toBe('alpha/second');
    expect(http).toHaveBeenCalledTimes(3);
    const third = await listAccountRepositories(account, http, second.next);
    expect(third.repositories[0]?.fullName).toBe('beta/third');
    expect(third.next).toBeNull();
  });

  it('refuses foreign pagination links and reports API errors through the shared forge transport', async () => {
    const account = { host: 'github.com', provider: 'github' };
    const http = vi.fn<HttpClient>()
      .mockResolvedValueOnce(response([], { link: '<https://elsewhere.test/user/repos?page=2>; rel="next"' }))
      .mockResolvedValueOnce(response({ message: 'Rate limited' }, { status: 429 }));
    await expect(listAccountRepositories(account, http)).rejects.toThrow('invalid repository pagination link');
    await expect(listAccountRepositories(account, http)).rejects.toThrow('GitHub request failed (429): Rate limited');
    expect(http).toHaveBeenCalledTimes(2);
  });
});
