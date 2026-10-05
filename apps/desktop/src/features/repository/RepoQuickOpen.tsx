import { useEffect, useMemo, useRef, useState } from 'react';
import { Command } from 'cmdk';
import { useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { AlertTriangle, FolderGit2, FolderTree } from 'lucide-react';
import { Kbd, cn } from '@angkorgit/design-system';
import { chordLabels, filterFiles, parseChordId, type RecentRepository } from '@angkorgit/core';
import { ipc } from '@/core/ipc';
import { useSettings } from '@/features/settings/store';
import { useUi } from '@/features/ui/store';
import { isMac, shortenHome } from '@/shared/utils';
import { useRepo } from './store';
import { switchToRepo } from './useRepoShortcuts';

const MAX_RESULTS = 100;

function ranked(recents: RecentRepository[], query: string): RecentRepository[] {
  const matches = filterFiles(recents, (r) => r.path, query);
  const q = query.trim().toLowerCase();
  if (!q) return matches.slice(0, MAX_RESULTS);
  const score = (r: RecentRepository) => {
    const name = r.name.toLowerCase();
    if (name === q) return 0;
    if (name.startsWith(q)) return 1;
    if (name.includes(q)) return 2;
    return 3;
  };
  return matches
    .map((r, i) => ({ r, i, s: score(r) }))
    .sort((a, b) => a.s - b.s || a.i - b.i)
    .slice(0, MAX_RESULTS)
    .map(({ r }) => r);
}

function parentOf(path: string): string {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return cut > 0 ? shortenHome(path.slice(0, cut)) : '';
}

export function RepoQuickOpen() {
  const navigate = useNavigate();
  const location = useLocation();
  const pathname = useRef(location.pathname);
  pathname.current = location.pathname;
  const open = useUi((s) => s.repoSwitcherOpen);
  const setOpen = useUi((s) => s.setRepoSwitcherOpen);
  const tabs = useUi((s) => s.repoTabs);
  const worktreeTabs = useUi((s) => s.worktreeTabs);
  const recents = useRepo((s) => s.recents);
  const current = useRepo((s) => s.repo?.path ?? null);
  const shortcuts = useSettings((s) => s.repoShortcuts);
  const [search, setSearch] = useState('');
  const [missing, setMissing] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) return;
    setSearch('');
    void useRepo.getState().loadRecents().catch(() => undefined);
  }, [open]);

  useEffect(() => {
    if (!open || recents.length === 0) return;
    let cancelled = false;
    void ipc
      .pathsExist(recents.map((r) => r.path))
      .then((flags) => {
        if (!cancelled) setMissing(new Set(recents.filter((_, i) => !flags[i]).map((r) => r.path)));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [open, recents]);

  const results = useMemo(() => ranked(recents, search), [recents, search]);

  const choose = (path: string) => {
    if (missing.has(path)) {
      toast.error('This folder no longer exists. Remove it from recents on the welcome page.');
      return;
    }
    setOpen(false);
    const ensureRepoRoute = () => {
      if (pathname.current !== '/repo') navigate('/repo');
    };
    if (path === current) {
      ensureRepoRoute();
      return;
    }
    void switchToRepo(path, ensureRepoRoute);
  };

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      label="Switch repository"
      shouldFilter={false}
      className="fixed left-1/2 top-24 z-50 w-full max-w-xl -translate-x-1/2 overflow-hidden rounded-lg border border-border bg-surface-overlay shadow-soft"
    >
      <Command.Input
        value={search}
        onValueChange={setSearch}
        placeholder="Search recent repositories by name or path…"
        className="h-11 w-full border-b border-border-subtle bg-transparent px-4 text-sm text-foreground outline-none placeholder:text-faint"
      />
      <Command.List className="max-h-96 overflow-y-auto p-1.5" data-repo-switcher>
        <Command.Empty className="px-3 py-8 text-center text-sm text-faint">
          {recents.length === 0 ? 'No recent repositories yet.' : `No repositories match “${search.trim()}”.`}
        </Command.Empty>
        {results.map((recent) => {
          const gone = missing.has(recent.path);
          const isTab = tabs.includes(recent.path);
          const isCurrent = recent.path === current;
          const chord = shortcuts[recent.path] ? parseChordId(shortcuts[recent.path]) : null;
          return (
            <Command.Item
              key={recent.path}
              value={recent.path}
              onSelect={() => choose(recent.path)}
              data-repo-path={recent.path}
              className="flex cursor-default select-none items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-foreground data-[selected=true]:bg-surface-raised"
            >
              <span
                className={cn(
                  'flex size-7 shrink-0 items-center justify-center rounded-md',
                  gone ? 'bg-surface-raised text-faint' : 'bg-primary/10 text-primary',
                )}
              >
                {worktreeTabs.includes(recent.path) ? <FolderTree className="size-3.5" /> : <FolderGit2 className="size-3.5" />}
              </span>
              <span className="flex min-w-0 flex-1 flex-col leading-tight">
                <span className={cn('truncate', gone ? 'text-muted' : 'font-medium')}>{recent.name}</span>
                <span className="truncate font-mono text-[11px] text-faint" title={recent.path}>
                  {parentOf(recent.path)}
                </span>
              </span>
              {gone && (
                <span className="flex shrink-0 items-center gap-1 text-[11px] text-danger">
                  <AlertTriangle className="size-3" /> folder missing
                </span>
              )}
              {!gone && (isCurrent || isTab) && (
                <span
                  className="shrink-0 rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary"
                  data-repo-tab-state={isCurrent ? 'current' : 'open'}
                >
                  {isCurrent ? 'Current' : 'Open tab'}
                </span>
              )}
              {chord && (
                <span className="flex shrink-0 items-center gap-0.5">
                  {chordLabels(chord, isMac).map((key, index) => (
                    <Kbd key={index}>{key}</Kbd>
                  ))}
                </span>
              )}
            </Command.Item>
          );
        })}
      </Command.List>
      <div className="flex items-center gap-4 border-t border-border-subtle px-3 py-1.5 text-[10px] text-faint">
        <span className="flex items-center gap-1">
          <Kbd>↑↓</Kbd> move
        </span>
        <span className="flex items-center gap-1">
          <Kbd>⏎</Kbd> open or switch to its tab
        </span>
        <span className="flex items-center gap-1">
          <Kbd>esc</Kbd> close
        </span>
        <span className="ml-auto">
          {results.length < recents.length && search.trim()
            ? `${results.length} of ${recents.length}`
            : `${recents.length} repositories`}
        </span>
      </div>
    </Command.Dialog>
  );
}
