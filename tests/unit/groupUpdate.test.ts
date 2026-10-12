import { expect, it, vi } from 'vitest';
import { classify, updateGroupRepositories, type GroupRepositoryResult } from '../../apps/desktop/src/features/repository/groupUpdate';

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

it('gives partial success one outcome shared by counters and badges', () => {
  const changes = [{ name: 'origin/main', oldOid: 'one', newOid: 'two', commits: 1 }];
  expect(classify({ status: 'partial', message: 'origin fetched, backup failed', changes })).toBe('partial');
  expect(classify({ status: 'partial', message: 'origin unchanged, backup failed', changes: [] })).toBe('partial');
  expect(classify({ status: 'failed', message: 'offline', changes: [] })).toBe('failed');
  expect(classify({ status: 'ok', message: 'fetched', changes })).toBe('updated');
  expect(classify({ status: 'ok', message: 'fetched', changes: [] })).toBe('unchanged');
  expect(classify({ status: 'up_to_date', message: 'current', changes: [] })).toBe('unchanged');
  expect(classify({ status: 'skipped', message: 'dirty', changes: [] })).toBe('skipped');
  expect(classify({ status: 'cancelled', message: 'stopped', changes })).toBe('cancelled');
});

it('cancels a hanging operation without starting the remaining repositories and retains late results', async () => {
  const repos = ['slow', 'next'].map((name) => ({ name, path: `/${name}`, lastOpenedAt: 0 }));
  const controller = new AbortController();
  let finish!: (result: GroupRepositoryResult) => void;
  const pending = new Promise<GroupRepositoryResult>((resolve) => { finish = resolve; });
  const update = vi.fn(() => pending);
  const results: GroupRepositoryResult[] = [];
  const run = updateGroupRepositories(repos, update, (result) => results.push(result), controller.signal);
  await Promise.resolve();
  controller.abort();
  await run;
  expect(update).toHaveBeenCalledTimes(1);
  expect(results.map((r) => r.status)).toEqual(['cancelled', 'cancelled']);
  finish({ repo: repos[0], status: 'cancelled', message: 'Kept completed remote fetch', changes: [{ name: 'origin/main', oldOid: 'one', newOid: 'two', commits: 1 }] });
  await vi.waitFor(() => expect(results).toHaveLength(3));
  expect(results[2].changes).toHaveLength(1);
});

it('does not start any operation when already cancelled', async () => {
  const controller = new AbortController();
  controller.abort();
  const update = vi.fn();
  const results: GroupRepositoryResult[] = [];
  await updateGroupRepositories([{ name: 'repo', path: '/repo', lastOpenedAt: 0 }], update, (r) => results.push(r), controller.signal);
  expect(update).not.toHaveBeenCalled();
  expect(results[0].status).toBe('cancelled');
});

it('delivers one cancellation when aborted before the pending microtask starts', async () => {
  const controller = new AbortController();
  const update = vi.fn();
  const onResult = vi.fn();
  const run = updateGroupRepositories([{ name: 'repo', path: '/repo', lastOpenedAt: 0 }], update, onResult, controller.signal);
  controller.abort();
  await run;
  await Promise.resolve();
  expect(update).not.toHaveBeenCalled();
  expect(onResult).toHaveBeenCalledTimes(1);
  expect(onResult.mock.calls[0][0].status).toBe('cancelled');
});
