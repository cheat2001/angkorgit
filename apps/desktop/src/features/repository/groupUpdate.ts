import type { GroupUpdateResult, RecentRepository } from '@angkorgit/core';

export interface GroupRepositoryResult extends GroupUpdateResult {
  repo: RecentRepository;
}

export type GroupResultKind = 'updated' | 'unchanged' | 'skipped' | 'failed' | 'partial' | 'cancelled';

export function classify(result: GroupUpdateResult): GroupResultKind {
  if (result.status === 'cancelled') return 'cancelled';
  if (result.status === 'partial') return 'partial';
  if (result.status === 'failed') return 'failed';
  if (result.status === 'skipped') return 'skipped';
  return result.changes.length > 0 ? 'updated' : 'unchanged';
}

export async function updateGroupRepositories(
  repos: readonly RecentRepository[],
  update: (path: string) => Promise<GroupUpdateResult>,
  onResult: (result: GroupRepositoryResult) => void,
  signal?: AbortSignal,
): Promise<void> {
  for (const repo of repos) {
    const cancelled: GroupUpdateResult = { status: 'cancelled', message: 'Cancelled; completed updates are kept', changes: [] };
    if (signal?.aborted) {
      onResult({ ...cancelled, repo });
      continue;
    }
    let updateStarted = false;
    const pending = Promise.resolve().then(() => {
      if (signal?.aborted) return cancelled;
      updateStarted = true;
      return update(repo.path);
    }).catch((error): GroupUpdateResult => ({
      status: 'failed', message: (error as { message?: string })?.message ?? String(error), changes: [],
    }));
    let onAbort: (() => void) | undefined;
    const aborted = new Promise<GroupUpdateResult>((resolve) => {
      onAbort = () => resolve(cancelled);
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) onAbort();
    });
    const winner = await Promise.race([
      pending.then((result) => ({ source: 'pending' as const, result })),
      aborted.then((result) => ({ source: 'abort' as const, result })),
    ]);
    if (onAbort) signal?.removeEventListener('abort', onAbort);
    onResult({ ...winner.result, repo });
    if (winner.source === 'abort' && updateStarted) {
      void pending.then((settled) => onResult({ ...settled, repo }));
    }
  }
}
