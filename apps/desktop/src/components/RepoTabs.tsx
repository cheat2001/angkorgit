import { toast } from 'sonner';
import { Plus, X } from 'lucide-react';
import { Button, Hint, cn } from '@angkorgit/design-system';
import { pickDirectory } from '@/core/ipc';
import { useRepo } from '@/features/repository/store';
import { useUi } from '@/features/ui/store';

export function RepoTabs() {
  const repo = useRepo((s) => s.repo);
  const tabs = useUi((s) => s.repoTabs);

  const activate = (path: string) => {
    if (path === repo?.path) return;
    void useRepo
      .getState()
      .open(path)
      .catch((error) => {
        toast.error(
          `Could not open: ${(error as { message?: string }).message ?? error}`,
        );
        useUi.getState().closeRepoTab(path);
      });
  };

  const close = (path: string) => {
    const remaining = tabs.filter((t) => t !== path);
    useUi.getState().closeRepoTab(path);
    if (repo?.path !== path) return;
    if (remaining.length > 0) activate(remaining[remaining.length - 1]);
    else useRepo.getState().close();
  };

  const addNew = () => {
    void (async () => {
      const dir = await pickDirectory('Open a repository');
      if (!dir) return;
      try {
        await useRepo.getState().open(dir);
      } catch (error) {
        toast.error(
          `Could not open repository: ${(error as { message?: string }).message ?? error}`,
        );
      }
    })();
  };

  const label = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

  return (
    <div className="flex h-9 shrink-0 items-end gap-0.5 border-b border-border-subtle bg-surface px-2">
      <div className="flex min-w-0 flex-1 items-end gap-0.5 overflow-x-auto">
        {tabs.map((path) => {
          const active = path === repo?.path;
          return (
            <div
              key={path}
              role="tab"
              aria-selected={active}
              title={path}
              onClick={() => activate(path)}
              onAuxClick={(e) => {
                if (e.button === 1) close(path); // middle-click closes
              }}
              className={cn(
                'group flex h-8 min-w-0 max-w-44 shrink-0 cursor-default items-center gap-1.5 rounded-t-md border border-b-0 px-3 text-xs',
                active
                  ? 'border-border-subtle bg-background text-foreground'
                  : 'border-transparent text-muted hover:bg-surface-raised hover:text-foreground',
              )}
            >
              <span className="min-w-0 truncate">{label(path)}</span>
              <button
                type="button"
                aria-label={`Close ${label(path)}`}
                className={cn(
                  'shrink-0 rounded-sm p-0.5 hover:bg-surface-overlay hover:text-foreground',
                  active ? 'text-muted' : 'text-transparent group-hover:text-muted',
                )}
                onClick={(e) => {
                  e.stopPropagation();
                  close(path);
                }}
              >
                <X className="size-3" />
              </button>
            </div>
          );
        })}
      </div>
      <Hint label="Open another repository">
        <Button
          variant="ghost"
          size="icon-sm"
          className="mb-0.5 shrink-0"
          aria-label="Open another repository"
          onClick={addNew}
        >
          <Plus className="size-4" />
        </Button>
      </Hint>
    </div>
  );
}
