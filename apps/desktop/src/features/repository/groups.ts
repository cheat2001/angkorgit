import { toast } from 'sonner';
import type { RepoGroup } from '@angkorgit/core';
import { ipc } from '@/core/ipc';
import { confirmDialog } from '@/components/confirm';
import { useRepo } from './store';
import { closeRepoTabs } from './tabs';
import { useSettings } from '@/features/settings/store';
import { useUi } from '@/features/ui/store';

export function repoGroupColor(color: number): string {
  return `hsl(var(--graph-${color % 10}))`;
}

export function repoGroupTint(color: number): string {
  return `hsl(var(--graph-${color % 10}) / 0.15)`;
}


export function plural(count: number, noun: string): string {
  if (count === 1) return `1 ${noun}`;
  return `${count} ${noun.endsWith('y') ? `${noun.slice(0, -1)}ies` : `${noun}s`}`;
}

export async function openRepoGroup(group: RepoGroup, paths: readonly string[], ensureRepoRoute?: () => void): Promise<void> {
  if (useRepo.getState().opening !== null) return;
  const exists = await ipc.pathsExist([...paths]);
  const present = paths.filter((_, index) => exists[index]);
  const missing = paths.length - present.length;
  if (present.length === 0) {
    toast.error(
      paths.length === 0
        ? `${group.name} has no repositories yet`
        : `None of the folders in ${group.name} exist any more`,
    );
    return;
  }
  const ui = useUi.getState();
  for (const path of present) ui.addRepoTab(path);
  const current = useRepo.getState().repo?.path;
  if (!current || !present.includes(current)) {
    try {
      await useRepo.getState().open(present[0]);
    } catch (error) {
      ui.closeRepoTab(present[0]);
      toast.error(`Could not open ${present[0].split('/').pop()}: ${(error as { message?: string }).message ?? error}`);
      return;
    }
  }
  ensureRepoRoute?.();
  toast.success(`${group.name}: ${plural(present.length, 'repository')} open in tabs`, {
    description: missing > 0 ? `${plural(missing, 'folder')} no longer exist and stayed closed.` : undefined,
  });
}

export function closeRepoGroup(group: RepoGroup, paths: readonly string[]): void {
  const open = useUi.getState().repoTabs.filter((tab) => paths.includes(tab));
  if (open.length === 0) return;
  closeRepoTabs(open);
  toast.success(`Closed ${plural(open.length, 'tab')} from ${group.name}`);
}

export async function deleteRepoGroup(group: RepoGroup, repoCount: number): Promise<boolean> {
  if (repoCount > 0) {
    const ok = await confirmDialog({
      title: `Ungroup “${group.name}”?`,
      description: `The group goes away. Its ${plural(repoCount, 'repository')} stay in your recent list and any open tabs stay open.`,
      confirmLabel: 'Ungroup',
      destructive: true,
    });
    if (!ok) return false;
  }
  useSettings.getState().removeRepoGroup(group.id);
  toast.success(`${group.name} ungrouped`);
  return true;
}
