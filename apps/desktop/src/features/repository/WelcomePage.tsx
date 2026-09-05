import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  AlertTriangle,
  Clock,
  Copy,
  FolderGit2,
  FolderOpen,
  FolderTree,
  GitBranchPlus,
  MoreHorizontal,
  Search,
  Settings,
  Trash2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Hint,
  Input,
  Logo,
  Spinner,
  TemplePattern,
  cn,
} from '@angkorgit/design-system';
import type { RecentRepository } from '@angkorgit/core';
import { appVersion, ipc, pickDirectory } from '@/core/ipc';
import { useRepo } from './store';
import { useUi } from '@/features/ui/store';
import { CloneDialog } from './CloneDialog';
import { SettingsDialog } from '@/features/settings/SettingsDialog';
import { SettingEmpty } from '@/features/settings/SettingCard';
import { isMac, timeAgo } from '@/shared/utils';

function shortenHome(path: string): string {
  return path.replace(/^(\/Users\/[^/]+|\/home\/[^/]+|[A-Z]:\\Users\\[^\\]+)(?=[/\\]|$)/, '~');
}

export function WelcomePage() {
  const navigate = useNavigate();
  const { recents, open, opening, loadRecents } = useRepo();
  const openDialog = useUi((s) => s.openDialog);
  const worktreeTabs = useUi((s) => s.worktreeTabs);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [missing, setMissing] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<{ x: number; y: number; repo: RecentRepository } | null>(null);
  const [version, setVersion] = useState('');

  useEffect(() => {
    void appVersion()
      .then(setVersion)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (recents.length === 0) {
      setMissing(new Set());
      return;
    }
    let cancelled = false;
    void ipc
      .pathsExist(recents.map((r) => r.path))
      .then((flags) => {
        if (cancelled) return;
        setMissing(new Set(recents.filter((_, i) => !flags[i]).map((r) => r.path)));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [recents]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return recents;
    return recents.filter(
      (r) => r.name.toLowerCase().includes(q) || r.path.toLowerCase().includes(q),
    );
  }, [recents, query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  const openRepository = async (path: string) => {
    if (useRepo.getState().opening !== null) return;
    if (missing.has(path)) {
      toast.error('This folder no longer exists. Remove it from recents or open it from its new location.');
      return;
    }
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
    await ipc.removeRecent(path);
    await loadRecents();
  };

  const onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      const target = filtered[activeIndex];
      if (target) void openRepository(target.path);
    }
  };

  const openMenuAt = (x: number, y: number, repo: RecentRepository) => setMenu({ x, y, repo });

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
            <Hint label="Settings">
              <Button variant="ghost" size="icon" onClick={() => openDialog('settings')} aria-label="Settings">
                <Settings />
              </Button>
            </Hint>
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
            {recents.length > 0 && <span className="text-xs text-faint">{recents.length}</span>}
            {recents.length > 0 && (
              <div className="relative ml-auto w-56">
                <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-faint" />
                <Input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={onSearchKey}
                  placeholder="Search, ↑↓ to choose, ⏎ to open"
                  aria-label="Search recent repositories"
                  className="h-7 pl-8 text-xs"
                />
              </div>
            )}
          </div>
          <div className="max-h-72 overflow-y-auto p-2">
            {recents.length === 0 ? (
              <SettingEmpty
                icon={<FolderGit2 className="size-4" />}
                title="No repositories yet"
                description="Open a folder that already has a .git directory, or clone one from a URL. Everything you open shows up here."
                action={
                  <span className="flex gap-2">
                    <Button variant="secondary" size="sm" onClick={browse}>
                      <FolderOpen className="size-3.5" /> Open
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => openDialog('clone')}>
                      <GitBranchPlus className="size-3.5" /> Clone
                    </Button>
                  </span>
                }
              />
            ) : filtered.length === 0 ? (
              <p className="px-3 py-8 text-center text-sm text-faint">No repositories match “{query.trim()}”.</p>
            ) : (
              filtered.map((repo, index) => {
                const gone = missing.has(repo.path);
                const isWorktree = worktreeTabs.includes(repo.path);
                const active = index === activeIndex;
                return (
                  <div
                    key={repo.path}
                    role="button"
                    tabIndex={0}
                    aria-current={active || undefined}
                    className={cn(
                      'group flex items-center gap-3 rounded-md px-2.5 py-2 transition-colors',
                      gone ? 'cursor-default' : 'cursor-pointer hover:bg-surface-raised',
                      active && 'bg-surface-raised ring-1 ring-inset ring-primary/40',
                    )}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => void openRepository(repo.path)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void openRepository(repo.path);
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      openMenuAt(e.clientX, e.clientY, repo);
                    }}
                  >
                    <span
                      className={cn(
                        'flex size-8 shrink-0 items-center justify-center rounded-md',
                        gone ? 'bg-surface-raised text-faint' : 'bg-primary/10 text-primary',
                      )}
                    >
                      {isWorktree ? <FolderTree className="size-4" /> : <FolderGit2 className="size-4" />}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col leading-tight">
                      <span className="flex items-center gap-2">
                        <span className={cn('truncate text-sm font-medium', gone ? 'text-muted' : 'text-foreground')}>
                          {repo.name}
                        </span>
                        {gone && (
                          <span className="flex shrink-0 items-center gap-1 text-[11px] text-danger">
                            <AlertTriangle className="size-3" /> folder missing
                          </span>
                        )}
                      </span>
                      <span className="truncate font-mono text-[11px] text-faint" title={repo.path}>
                        {shortenHome(repo.path)}
                      </span>
                    </span>
                    {opening === repo.path ? (
                      <Spinner className="size-3.5 shrink-0 text-primary" />
                    ) : (
                      <span className="shrink-0 text-xs text-faint">{timeAgo(repo.lastOpenedAt)}</span>
                    )}
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="shrink-0 opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
                      aria-label={`${repo.name} actions`}
                      onClick={(e) => {
                        e.stopPropagation();
                        const rect = e.currentTarget.getBoundingClientRect();
                        openMenuAt(rect.left, rect.bottom + 4, repo);
                      }}
                    >
                      <MoreHorizontal className="size-3.5" />
                    </Button>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <p className="mt-6 flex items-center justify-center gap-2 text-[11px] text-faint">
          <span>{version ? `AngKorGit v${version}` : 'AngKorGit'}</span>
          <span aria-hidden>·</span>
          <button
            type="button"
            className="hover:text-foreground hover:underline"
            onClick={() =>
              void import('@/features/updater/check').then(({ checkForUpdates }) =>
                checkForUpdates({ silent: false }),
              )
            }
          >
            Check for updates
          </button>
        </p>
      </div>

      {menu && (
        <DropdownMenu open onOpenChange={(o) => !o && setMenu(null)}>
          <DropdownMenuTrigger asChild>
            <span style={{ position: 'fixed', left: menu.x, top: menu.y }} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="bottom">
            <DropdownMenuLabel className="max-w-72 truncate font-mono">{shortenHome(menu.repo.path)}</DropdownMenuLabel>
            <DropdownMenuItem disabled={missing.has(menu.repo.path)} onClick={() => void openRepository(menu.repo.path)}>
              <FolderGit2 /> Open
            </DropdownMenuItem>
            <DropdownMenuItem disabled={missing.has(menu.repo.path)} onClick={() => void ipc.revealPath(menu.repo.path)}>
              <FolderOpen /> {isMac ? 'Reveal in Finder' : 'Show in file manager'}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                void navigator.clipboard.writeText(menu.repo.path);
                toast.success('Path copied');
              }}
            >
              <Copy /> Copy path
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem destructive onClick={() => void removeRecent(menu.repo.path)}>
              {missing.has(menu.repo.path) ? <Trash2 /> : <X />} Remove from recents
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <CloneDialog onCloned={(path) => void openRepository(path)} />
      <SettingsDialog />
    </motion.div>
  );
}
