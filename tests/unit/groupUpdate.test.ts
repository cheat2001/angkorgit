import { expect, it } from 'vitest';
import { updateGroupRepositories, type GroupRepositoryResult } from '../../apps/desktop/src/features/repository/groupUpdate';

it('runs in order, preserves partial results, and continues after a repository fails', async () => {
  const repos = ['missing', 'updated', 'failed', 'current'].map((name) => ({ name, path: `/${name}`, lastOpenedAt: 0 }));
  const results: GroupRepositoryResult[] = [];
  const calls: string[] = [];
  await updateGroupRepositories(repos, async (path) => {
    calls.push(path);
    if (path === '/failed') throw { message: 'Authentication failed' };
    return { status: path === '/missing' ? 'skipped' : path === '/current' ? 'up_to_date' : 'ok', message: path, changes: [] };
  }, (result) => results.push(result));
  expect(calls).toEqual(repos.map((r) => r.path));
  expect(results.map((r) => r.status)).toEqual(['skipped', 'ok', 'failed', 'up_to_date']);
  expect(results[2].message).toBe('Authentication failed');
  expect(results.map((r) => r.repo)).toEqual(repos);
});
