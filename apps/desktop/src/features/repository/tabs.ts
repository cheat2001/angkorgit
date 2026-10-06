import { toast } from 'sonner';
import { useRepo } from './store';
import { killTerminalSession } from '@/features/terminal/sessions';
import { useUi } from '@/features/ui/store';

export async function activateTab(path: string): Promise<void> {
  if (path === useRepo.getState().repo?.path) return;
  try {
    await useRepo.getState().open(path);
  } catch (error) {
    toast.error(`Could not open: ${(error as { message?: string }).message ?? error}`);
    useUi.getState().closeRepoTab(path);
    killTerminalSession(path);
  }
}

export function closeRepoTabs(paths: readonly string[]): void {
  const ui = useUi.getState();
  const closing = new Set(paths);
  const remaining = ui.repoTabs.filter((tab) => !closing.has(tab));
  for (const tab of ui.repoTabs) {
    if (!closing.has(tab)) continue;
    ui.closeRepoTab(tab);
    killTerminalSession(tab);
  }
  const current = useRepo.getState().repo?.path;
  if (!current || !closing.has(current)) return;
  if (remaining.length > 0) void activateTab(remaining[remaining.length - 1]);
  else useRepo.getState().close();
}
