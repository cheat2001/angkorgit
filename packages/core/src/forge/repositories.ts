import type { HttpClient, HttpResponse } from '../ai/types';
import { bitbucketMessage } from './providers/bitbucket';
import { githubApiBase, githubMessage } from './providers/github';
import { gitlabMessage } from './providers/gitlab';
import { createForgeJsonRequest } from './shared';
import { ForgeError } from './types';

export interface AccountRepository {
  fullName: string;
  cloneUrl: string;
}

type BitbucketCursor = {
  kind: 'bitbucket';
  workspacePage: string | null;
  workspaces: string[];
  repositoryPage: string | null;
};

export type RepositoryCursor = { kind: 'github' | 'gitlab'; url: string } | BitbucketCursor;

export interface AccountRepositoryPage {
  repositories: AccountRepository[];
  next: RepositoryCursor | null;
  skipped: number;
}

const bitbucketApi = 'https://api.bitbucket.org/2.0';
const workspaceList = `${bitbucketApi}/user/workspaces?pagelen=50`;
const forgeDetails = {
  github: { label: 'GitHub', parseMessage: githubMessage, scopes: 'Metadata and Contents read access' },
  gitlab: { label: 'GitLab', parseMessage: gitlabMessage, scopes: 'read_api (or api) and repository read access' },
  bitbucket: { label: 'Bitbucket', parseMessage: bitbucketMessage, scopes: 'read:workspace:bitbucket and read:repository:bitbucket' },
};

function linkNext(link: string | undefined): string | undefined {
  return link?.match(/<([^>]+)>\s*;\s*rel="next"/)?.[1];
}

function resolvePage(current: string, next: string | null | undefined): string | null {
  if (!next) return null;
  const original = new URL(current);
  const target = new URL(next, original);
  if (target.origin !== original.origin || target.pathname !== original.pathname ||
      target.username || target.password || target.hash || target.href === original.href) {
    throw new Error('The provider returned an invalid repository pagination link.');
  }
  return target.href;
}

function gitlabNext(current: string, response: HttpResponse): string | null {
  const link = linkNext(response.link);
  if (!response.nextPage && !link) return null;
  const next = response.nextPage || new URL(link!, current).searchParams.get('page');
  const url = new URL(current);
  if (!next || !/^\d+$/.test(next) || !Number.isSafeInteger(Number(next)) ||
      Number(next) <= Number(url.searchParams.get('page'))) {
    throw new Error('GitLab returned an invalid repository page number.');
  }
  url.searchParams.set('page', next);
  return url.href;
}

function repositoryPage(
  names: unknown[],
  origin: string,
  next: RepositoryCursor | null,
): AccountRepositoryPage {
  const repositories: AccountRepository[] = [];
  for (const fullName of names) {
    if (typeof fullName !== 'string') continue;
    const segments = fullName.split('/');
    if (segments.length < 2 || segments.some((segment) => !segment || segment === '.' || segment === '..')) continue;
    repositories.push({ fullName, cloneUrl: `${origin}/${segments.map(encodeURIComponent).join('/')}.git` });
  }
  return { repositories, next, skipped: names.length - repositories.length };
}

type RepositoryRequest = (url: string) => Promise<{ data: unknown; response: HttpResponse }>;

async function bitbucketRepositories(
  get: RepositoryRequest,
  origin: string,
  cursor: BitbucketCursor,
): Promise<AccountRepositoryPage> {
  let { workspacePage, workspaces, repositoryPage: page } = cursor;
  if (workspaces.length === 0 && workspacePage) {
    const { data } = await get(workspacePage);
    const result = data as { values?: { workspace?: { slug?: string } }[]; next?: string };
    if (!Array.isArray(result?.values)) throw new Error('Bitbucket returned an invalid workspace list.');
    workspaces = result.values.flatMap((entry) => {
      const slug = entry?.workspace?.slug;
      return typeof slug === 'string' && slug ? [slug] : [];
    });
    workspacePage = resolvePage(workspacePage, result.next);
  }

  const workspace = workspaces[0];
  if (!workspace) {
    return {
      repositories: [],
      next: workspacePage ? { kind: 'bitbucket', workspaces, workspacePage, repositoryPage: null } : null,
      skipped: 0,
    };
  }
  page ??= `${bitbucketApi}/user/workspaces/${encodeURIComponent(workspace)}/permissions/repositories?pagelen=50`;
  const { data } = await get(page);
  const result = data as { values?: { repository?: { full_name?: string } }[]; next?: string };
  if (!Array.isArray(result?.values)) throw new Error('Bitbucket returned an invalid repository list.');
  page = resolvePage(page, result.next);
  if (!page) workspaces = workspaces.slice(1);
  return repositoryPage(
    result.values.map((entry) => entry?.repository?.full_name),
    origin,
    page || workspaces.length || workspacePage ? { kind: 'bitbucket', workspaces, workspacePage, repositoryPage: page } : null,
  );
}

export async function listAccountRepositories(
  account: { host: string; provider: string },
  http: HttpClient,
  cursor?: RepositoryCursor | null,
): Promise<AccountRepositoryPage> {
  const kind = account.provider === 'gitlab-self' ? 'gitlab' : account.provider;
  if (kind !== 'github' && kind !== 'gitlab' && kind !== 'bitbucket') {
    throw new Error('Repository browsing is unavailable for this provider.');
  }
  const { label, parseMessage, scopes } = forgeDetails[kind];
  const origin = new URL(`https://${account.host}`).origin;
  const get: RepositoryRequest = async (url) => {
    let response!: HttpResponse;
    try {
      const request = createForgeJsonRequest(http, kind, label, parseMessage, (res) => { response = res; });
      return { data: await request(url, 'GET'), response };
    } catch (error) {
      if (error instanceof ForgeError && (error.status === 401 || error.status === 403)) {
        throw new Error(`${error.message}. Check that the saved token has ${scopes}.`);
      }
      throw error;
    }
  };
  if (kind === 'bitbucket') {
    return bitbucketRepositories(get, origin, cursor?.kind === kind
      ? cursor
      : { kind, workspacePage: workspaceList, workspaces: [], repositoryPage: null });
  }
  const first = kind === 'github'
    ? `${githubApiBase(new URL(origin).host)}/user/repos?per_page=50`
    : `${origin}/api/v4/projects?membership=true&simple=true&per_page=50&order_by=id&sort=asc&page=1`;
  const url = cursor?.kind === kind ? cursor.url : first;
  const { data, response } = await get(url);
  if (!Array.isArray(data)) throw new Error(`${label} returned an invalid repository list.`);
  const next = kind === 'gitlab' ? gitlabNext(url, response) : resolvePage(url, linkNext(response.link));
  return repositoryPage(
    data.map((entry) => kind === 'github' ? entry?.full_name : entry?.path_with_namespace),
    origin,
    next ? { kind, url: next } : null,
  );
}
