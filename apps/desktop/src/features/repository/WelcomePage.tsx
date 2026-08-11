import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Clock, FolderOpen, GitBranchPlus, Search, Settings, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button, Input, Logo, TemplePattern } from '@angkorgit/design-system';
import { pickDirectory } from '@/core/ipc';
import { useRepo } from './store';
import { useUi } from '@/features/ui/store';
import { CloneDialog } from './CloneDialog';
import { SettingsDialog } from '@/features/settings/SettingsDialog';
import { timeAgo } from '@/shared/utils';

export function WelcomePage() {
  const navigate = useNavigate();
  const { recents, open, loadRecents } = useRepo();
  const openDialog = useUi((s) => s.openDialog);
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return recents;
    return recents.filter(
      (r) => r.name.toLowerCase().includes(q) || r.path.toLowerCase().includes(q),
    );
  }, [recents, query]);

  const openRepository = async (path: string) => {
    try {
      await open(path);
      navigate('/repo');
    } catch (error) {
      toast.error(`Could not open repository: ${(error as { message?: string }).message ?? error}`);
    }
  };

  const browse = async () => {
    const dir = await pickDirectory('Open a Git repository');
    if (dir) await openRepository(dir);
  };

  const removeRecent = async (path: string) => {
    const { ipc } = await import('@/core/ipc');
    await ipc.removeRecent(path);
    await loadRecents();
  };

  return (
    <motion.div
      className="relative flex h-full items-center justify-center p-8"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      <TemplePattern className="[mask-image:radial-gradient(ellipse_at_center,transparent_30%,black_75%)]" />
      <div className="relative w-full max-w-3xl">
        <div className="mb-10 flex items-center gap-4">
          <div className="text-foreground">
            <Logo size={56} />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              AngKor<span className="text-primary">Git</span>
            </h1>
            <p className="text-sm text-muted">Everyday Git, made delightful.</p>
          </div>
          <div className="ml-auto">
            <Button variant="ghost" size="icon" onClick={() => openDialog('settings')} aria-label="Settings">
              <Settings />
            </Button>
          </div>
        </div>

        <div className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <button
            onClick={browse}
            className="group flex items-center gap-4 rounded-lg border border-border bg-surface p-4 text-left shadow-soft transition-colors hover:border-primary/50 hover:bg-surface-raised"
          >
            <span className="rounded-lg bg-primary/15 p-2.5 text-primary">
              <FolderOpen className="size-5" />
            </span>
            <span>
              <span className="block font-medium">Open repository</span>
              <span className="block text-xs text-muted">Browse for a local folder</span>
            </span>
          </button>
          <button
            onClick={() => openDialog('clone')}
            className="group flex items-center gap-4 rounded-lg border border-border bg-surface p-4 text-left shadow-soft transition-colors hover:border-primary/50 hover:bg-surface-raised"
          >
            <span className="rounded-lg bg-info/15 p-2.5 text-info">
              <GitBranchPlus className="size-5" />
            </span>
            <span>
              <span className="block font-medium">Clone repository</span>
              <span className="block text-xs text-muted">From a remote URL</span>
            </span>
          </button>
        </div>

        <div className="rounded-lg border border-border bg-surface shadow-soft">
          <div className="flex items-center gap-2 border-b border-border-subtle px-4 py-3">
            <Clock className="size-4 text-muted" />
            <span className="text-sm font-medium">Recent repositories</span>
            <div className="relative ml-auto w-56">
              <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-faint" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search repositories…"
                className="h-7 pl-8 text-xs"
              />
            </div>
          </div>
          <div className="max-h-72 overflow-y-auto p-2">
            {filtered.length === 0 ? (
              <p className="px-3 py-8 text-center text-sm text-faint">
                {recents.length === 0 ? 'No repositories yet — open or clone one to begin.' : 'No matches.'}
              </p>
            ) : (
              filtered.map((repo) => (
                <div
                  key={repo.path}
                  className="group flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 transition-colors hover:bg-surface-raised"
                  onClick={() => void openRepository(repo.path)}
                >
                  <span className="font-medium">{repo.name}</span>
                  <span className="truncate font-mono text-xs text-faint">{repo.path}</span>
                  <span className="ml-auto shrink-0 text-xs text-faint">{timeAgo(repo.lastOpenedAt)}</span>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="opacity-0 group-hover:opacity-100"
                    aria-label={`Remove ${repo.name} from recents`}
                    onClick={(e) => {
                      e.stopPropagation();
                      void removeRecent(repo.path);
                    }}
                  >
                    <X className="size-3.5" />
                  </Button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <CloneDialog onCloned={(path) => void openRepository(path)} />
      <SettingsDialog />
    </motion.div>
  );
}
