import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { toastOutcome } from '@/shared/toastOutcome';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  ChevronDown,
  Command,
  FolderGit2,
  FolderOpen,
  GitBranchPlus,
  Home,
  PanelLeft,
  Redo2,
  RefreshCw,
  Undo2,
  Settings,
  SquareTerminal,
  Tag,
  Archive,
  UserRound,
} from 'lucide-react';
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  Hint,
  Kbd,
  Logo,
  Separator,
  Spinner,
  cn,
} from '@angkorgit/design-system';
import { ipc, pickDirectory } from '@/core/ipc';
import { confirmDialog } from '@/components/confirm';
import { useRepo } from '@/features/repository/store';
import { abortMergeFlow } from '@/features/repository/merge';
import { sidebarVisible, useUi } from '@/features/ui/store';
import { useUndo } from '@/features/history/undoStore';
import { useSettings, type IdentityProfile } from '@/features/settings/store';
import { applyProfileToRepo, ensureRepoProfile } from '@/features/settings/profiles';
import { capCount, modKey } from '@/shared/utils';

function RepoSwitcher() {
  const repo = useRepo((s) => s.repo);
  const recents = useRepo((s) => s.recents);
  const open = useRepo((s) => s.open);
  const busy = useRepo((s) => s.busy);
  const openDialog = useUi((s) => s.openDialog);
  const profiles = useSettings((s) => s.profiles);
  const profileId = useRepo((s) => s.profileId);
  const [activeEmail, setActiveEmail] = useState('');

  useEffect(() => {
    if (!repo?.path) return;
    void ipc.configGet(repo.path, 'user.email').then((email) => setActiveEmail(email ?? ''));
  }, [repo?.path]);

  const assignProfile = async (profile: IdentityProfile) => {
    if (!repo) return;
    try {
      await applyProfileToRepo(repo.path, profile);
      setActiveEmail(profile.email);
      toast.success(`${repo.name} now uses the "${profile.label}" profile`);
    } catch (error) {
      toast.error(`Could not switch profile: ${(error as { message?: string }).message ?? error}`);
    }
  };

  if (!repo) return null;

  const assignedProfile =
    profiles.find((p) => p.id === profileId) ??
    (profileId ? undefined : profiles.find((p) => p.email === activeEmail));

  const switchTo = async (path: string) => {
    if (path === repo.path) return;
    try {
      await open(path);
      toast.success(`Switched to ${path.split('/').pop()}`);
    } catch (error) {
      toast.error(`Could not open repository: ${(error as { message?: string }).message ?? error}`);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            'mx-1 flex items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-surface-raised',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60',
          )}
          disabled={!!busy}
          aria-label="Switch repository"
        >
          <Logo size={22} className="text-foreground" />
          <span className="leading-tight">
            <span className="flex items-center gap-1 text-sm font-semibold">
              {repo.name}
              <ChevronDown className="size-3 text-faint" />
            </span>
            <span className="block font-mono text-[10px] text-faint">
              {repo.isDetached ? 'detached HEAD' : repo.headBranch ?? 'no branch'}
              {assignedProfile ? ` · ${assignedProfile.label}` : ''}
            </span>
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-72">
        <DropdownMenuLabel>Repositories</DropdownMenuLabel>
        {recents.map((recent) => {
          const isCurrent = recent.path === repo.path;
          return (
            <DropdownMenuItem key={recent.path} onClick={() => void switchTo(recent.path)}>
              {isCurrent ? <Check className="text-primary" /> : <FolderGit2 />}
              <span className="min-w-0 flex-1">
                <span className={cn('block truncate', isCurrent && 'text-primary')}>{recent.name}</span>
                <span className="block truncate font-mono text-[10px] text-faint">{recent.path}</span>
              </span>
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() =>
            void (async () => {
              const dir = await pickDirectory('Open a Git repository');
              if (dir) await switchTo(dir);
            })()
          }
        >
          <FolderOpen /> Open repository…
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => openDialog('clone')}>
          <GitBranchPlus /> Clone repository…
        </DropdownMenuItem>
        {profiles.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <UserRound /> Profile
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {profiles.map((profile) => {
                  const active = assignedProfile?.id === profile.id;
                  return (
                    <DropdownMenuItem key={profile.id} onClick={() => void assignProfile(profile)}>
                      {active ? <Check className="text-primary" /> : <UserRound />}
                      <span className="min-w-0 flex-1">
                        <span className="block">{profile.label}</span>
                        <span className="block truncate text-[10px] text-faint">{profile.email}</span>
                      </span>
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const STATE_LABELS: Record<string, string> = {
  rebase: 'Rebase in progress',
  merge: 'Merge in progress',
  cherrypick: 'Cherry-pick in progress',
  revert: 'Revert in progress',
  bisect: 'Bisect in progress',
};

function StateActions({ onRefresh }: { onRefresh: () => Promise<void> }) {
  const repo = useRepo((s) => s.repo);
  if (!repo || repo.state === 'clean') return null;
  const path = repo.path;
  const state = repo.state;

  const finish = () => void onRefresh();

  const continueRebase = () =>
    void (async () => {
      try {
        const outcome = await ipc.rebaseContinue(path);
        toastOutcome(outcome, 'Rebase continued');
      } catch (error) {
        toast.error(`Continue failed: ${(error as { message?: string }).message ?? error}`);
      }
      finish();
    })();

  const abortRebase = () =>
    void (async () => {
      const ok = await confirmDialog({
        title: 'Abort rebase?',
        description:
          'This rewinds the branch to where it was before the rebase started. Commits made during the rebase are discarded.',
        confirmLabel: 'Abort rebase',
        destructive: true,
      });
      if (!ok) return;
      try {
        await ipc.rebaseAbort(path);
        toast.success('Rebase aborted');
      } catch (error) {
        toast.error(`Abort failed: ${(error as { message?: string }).message ?? error}`);
      }
      finish();
    })();

  const abortMerge = () => void abortMergeFlow(path);

  const clearState = () =>
    void (async () => {
      const ok = await confirmDialog({
        title: `Clear ${state} state?`,
        description:
          `Git still marks this repository as mid-${state}. Clearing removes that marker and keeps every file and commit exactly as it is now. Use this when the ${state} is already finished.`,
        confirmLabel: 'Clear state',
      });
      if (!ok) return;
      try {
        await ipc.stateCleanup(path);
        toast.success('State cleared');
      } catch (error) {
        toast.error(`Clear failed: ${(error as { message?: string }).message ?? error}`);
      }
      finish();
    })();

  return (
    <DropdownMenu>
      <Hint label={STATE_LABELS[state] ?? state}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn(
              'flex items-center gap-1 rounded-md border border-danger/40 bg-danger/10 px-2 py-1',
              'font-mono text-[11px] text-danger hover:bg-danger/20',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/60',
            )}
            aria-label={`${state} in progress — actions`}
          >
            {state}
            <ChevronDown className="size-3" />
          </button>
        </DropdownMenuTrigger>
      </Hint>
      <DropdownMenuContent align="start" className="min-w-56">
        <DropdownMenuLabel>{STATE_LABELS[state] ?? state}</DropdownMenuLabel>
        {state === 'rebase' && (
          <>
            <DropdownMenuItem onClick={continueRebase}>
              <Redo2 /> Continue rebase
            </DropdownMenuItem>
            <DropdownMenuItem destructive onClick={abortRebase}>
              <Undo2 /> Abort rebase
            </DropdownMenuItem>
          </>
        )}
        {state === 'merge' && (
          <DropdownMenuItem destructive onClick={abortMerge}>
            <Undo2 /> Abort merge
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={clearState}>
          <Check /> Clear state, keep everything as is
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function UndoRedoButtons({ onRefresh }: { onRefresh: () => Promise<void> }) {
  const repo = useRepo((s) => s.repo);
  const undoStack = useUndo((s) => s.undoStack);
  const redoStack = useUndo((s) => s.redoStack);
  const path = repo?.path ?? '';

  const nextUndo = [...undoStack].reverse().find((e) => e.repoPath === path);
  const nextRedo = [...redoStack].reverse().find((e) => e.repoPath === path);

  const run = (direction: 'undo' | 'redo') => {
    const fn = direction === 'undo' ? useUndo.getState().undo : useUndo.getState().redo;
    void fn(path).then((ok) => {
      if (ok) void onRefresh();
    });
  };

  return (
    <>
      <Hint
        label={
          nextUndo ? (
            <span className="flex items-center gap-1">
              Undo: {nextUndo.label} <Kbd>{modKey()}</Kbd>
              <Kbd>Z</Kbd>
            </span>
          ) : (
            'Nothing to undo'
          )
        }
      >
        <Button
          variant="ghost"
          size="icon"
          aria-label="Undo"
          disabled={!nextUndo}
          onClick={() => run('undo')}
        >
          <Undo2 />
        </Button>
      </Hint>
      <Hint
        label={
          nextRedo ? (
            <span className="flex items-center gap-1">
              Redo: {nextRedo.label} <Kbd>{modKey()}</Kbd>
              <Kbd>⇧</Kbd>
              <Kbd>Z</Kbd>
            </span>
          ) : (
            'Nothing to redo'
          )
        }
      >
        <Button
          variant="ghost"
          size="icon"
          aria-label="Redo"
          disabled={!nextRedo}
          onClick={() => run('redo')}
        >
          <Redo2 />
        </Button>
      </Hint>
    </>
  );
}

export function Toolbar({ onRefresh }: { onRefresh: () => Promise<void> }) {
  const repo = useRepo((s) => s.repo);
  const status = useRepo((s) => s.status);
  const remotes = useRepo((s) => s.remotes);
  const busy = useRepo((s) => s.busy);
  const setBusy = useRepo((s) => s.setBusy);
  const toggleTerminal = useUi((s) => s.toggleTerminal);
  const toggleSidebar = useUi((s) => s.toggleSidebar);
  const sidebarOpen = useUi(sidebarVisible);
  const openDialog = useUi((s) => s.openDialog);
  const setPaletteOpen = useUi((s) => s.setPaletteOpen);
  const navigate = useNavigate();
  const [spinning, setSpinning] = useState(false);

  if (!repo) return null;
  const remote = remotes[0]?.name ?? 'origin';

  const run = async (label: string, op: () => Promise<{ status: string; message: string } | void>) => {
    if (busy) return;
    setBusy(label);
    try {
      const outcome = await op();
      if (outcome && 'message' in outcome) {
        toastOutcome(outcome, `${label} complete`);
      } else {
        toast.success(`${label} complete`);
      }
      await onRefresh();
    } catch (error) {
      toast.error(`${label} failed: ${(error as { message?: string }).message ?? error}`);
    } finally {
      setBusy(null);
    }
  };

  const runPush = (label: string, op: () => Promise<{ status: string; message: string } | void>) =>
    void (async () => {
      if (busy) return;
      await ensureRepoProfile(repo.path);
      await run(label, op);
    })();

  return (
    <header className="flex h-12 shrink-0 items-center gap-1 border-b border-border-subtle bg-surface px-2">
      <Hint label="Back to repositories">
        <Button variant="ghost" size="icon" aria-label="Home" onClick={() => navigate('/welcome')}>
          <Home />
        </Button>
      </Hint>
      <Hint
        label={
          <span className="flex items-center gap-1">
            {sidebarOpen ? 'Hide sidebar' : 'Show sidebar'} <Kbd>{modKey()}</Kbd>
            <Kbd>B</Kbd>
          </span>
        }
      >
        <Button
          variant="ghost"
          size="icon"
          aria-label={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
          className={!sidebarOpen ? 'text-primary' : undefined}
          onClick={toggleSidebar}
        >
          <PanelLeft />
        </Button>
      </Hint>
      <RepoSwitcher />
      <StateActions onRefresh={onRefresh} />

      <UndoRedoButtons onRefresh={onRefresh} />

      <Separator orientation="vertical" className="mx-2 h-6" />

      <Hint label={`Fetch ${remote}`}>
        <Button
          variant="ghost"
          size="sm"
          disabled={!!busy}
          onClick={() => void run('Fetch', () => ipc.fetch(repo.path, remote, true, true))}
        >
          <RefreshCw className={busy === 'Fetch' ? 'animate-spin' : ''} />
          Fetch
        </Button>
      </Hint>
      <Hint label={`Pull from ${remote}${status?.behind ? ` (${status.behind} behind)` : ''}`}>
        <Button
          variant="ghost"
          size="sm"
          disabled={!!busy}
          onClick={() => void run('Pull', () => ipc.pull(repo.path, remote))}
        >
          <ArrowDownToLine />
          Pull
          {status && status.behind > 0 && <Badge tone="info">{capCount(status.behind)}</Badge>}
        </Button>
      </Hint>
      <div className="flex items-center">
        <Hint label={`Push to ${remote}${status?.ahead ? ` (${status.ahead} ahead)` : ''}`}>
          <Button
            variant="ghost"
            size="sm"
            className="rounded-r-none"
            disabled={!!busy}
            onClick={() => runPush('Push', () => ipc.push(repo.path, remote, false, false, true))}
          >
            <ArrowUpFromLine />
            Push
            {status && status.ahead > 0 && <Badge tone="primary">{capCount(status.ahead)}</Badge>}
          </Button>
        </Hint>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" className="rounded-l-none" aria-label="Push options" disabled={!!busy}>
              <ChevronDown className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onClick={() => runPush('Push (force)', () => ipc.push(repo.path, remote, true, false, true))} destructive>
              Force push
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => runPush('Push with tags', () => ipc.push(repo.path, remote, false, true, true))}>
              Push with tags
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => void run('Fetch tags', () => ipc.fetch(repo.path, remote, true, false))}>
              Fetch tags
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Separator orientation="vertical" className="mx-2 h-6" />

      <Hint label="Create branch">
        <Button variant="ghost" size="icon" aria-label="Create branch" onClick={() => openDialog('createBranch')}>
          <GitBranchPlus />
        </Button>
      </Hint>
      <Hint label="Create tag">
        <Button variant="ghost" size="icon" aria-label="Create tag" onClick={() => openDialog('createTag')}>
          <Tag />
        </Button>
      </Hint>
      <Hint label="Stash changes">
        <Button variant="ghost" size="icon" aria-label="Stash changes" onClick={() => openDialog('createStash')}>
          <Archive />
        </Button>
      </Hint>

      <div className="ml-auto flex items-center gap-1">
        {busy && (
          <span className="mr-1 flex items-center gap-2 text-xs text-muted">
            <Spinner /> {busy}…
          </span>
        )}
        <Hint
          label={
            <span className="flex items-center gap-1">
              Command palette <Kbd>{modKey()}</Kbd>
              <Kbd>K</Kbd>
            </span>
          }
        >
          <Button variant="ghost" size="icon" aria-label="Command palette" onClick={() => setPaletteOpen(true)}>
            <Command />
          </Button>
        </Hint>
        <Hint
          label={
            <span className="flex items-center gap-1">
              Terminal <Kbd>{modKey()}</Kbd>
              <Kbd>`</Kbd>
            </span>
          }
        >
          <Button variant="ghost" size="icon" aria-label="Toggle terminal" onClick={toggleTerminal}>
            <SquareTerminal />
          </Button>
        </Hint>
        <Hint label="Refresh">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Refresh"
            onClick={() => {
              setSpinning(true);
              void onRefresh().finally(() => setSpinning(false));
            }}
          >
            <RefreshCw className={spinning ? 'animate-spin' : ''} />
          </Button>
        </Hint>
        <Hint label="Settings">
          <Button variant="ghost" size="icon" aria-label="Settings" onClick={() => openDialog('settings')}>
            <Settings />
          </Button>
        </Hint>
      </div>
    </header>
  );
}
