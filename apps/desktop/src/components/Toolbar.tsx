import { useEffect, useMemo, useState } from 'react';
import { chordLabels, groupRepos, parseChordId, type RecentRepository } from '@angkorgit/core';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { toastOutcome } from '@/shared/toastOutcome';
import { PushRejectedDialog } from './PushRejectedDialog';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  ChevronDown,
  Code,
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
  ArchiveRestore,
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
import { GroupDot } from '@/features/repository/RepoGroupMenu';
import { fetchRemotes, fetchResultMessage } from '@/features/repository/fetchRemotes';
import { abortMergeFlow } from '@/features/repository/merge';
import { sidebarVisible, useUi } from '@/features/ui/store';
import { useUndo } from '@/features/history/undoStore';
import { useSettings, type IdentityProfile } from '@/features/settings/store';
import { applyProfileToRepo, ensureRepoProfile } from '@/features/settings/profiles';
import { openInEditor, preferredEditor, useEditors } from '@/features/settings/editors';
import { capCount, isMac, modKey } from '@/shared/utils';

function RepoSwitcher() {
  const repo = useRepo((s) => s.repo);
  const recents = useRepo((s) => s.recents);
  const open = useRepo((s) => s.open);
  const busy = useRepo((s) => s.busy);
  const openDialog = useUi((s) => s.openDialog);
  const profiles = useSettings((s) => s.profiles);
  const shortcuts = useSettings((s) => s.repoShortcuts);
  const groups = useSettings((s) => s.repoGroups);
  const groupOf = useSettings((s) => s.repoGroupOf);
  const worktreeMains = useUi((s) => s.worktreeMains);
  const profileId = useRepo((s) => s.profileId);
  const [activeEmail, setActiveEmail] = useState('');
  const grouped = useMemo(() => groupRepos(recents, groups, groupOf, worktreeMains), [recents, groups, groupOf, worktreeMains]);

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

  const renderRecent = (recent: RecentRepository) => {
    const isCurrent = recent.path === repo.path;
    const chord = shortcuts[recent.path] ? parseChordId(shortcuts[recent.path]) : null;
    return (
      <DropdownMenuItem key={recent.path} onClick={() => void switchTo(recent.path)}>
        {isCurrent ? <Check className="text-primary" /> : <FolderGit2 />}
        <span className="min-w-0 flex-1">
          <span className={cn('block truncate', isCurrent && 'text-primary')}>{recent.name}</span>
          <span className="block truncate font-mono text-[10px] text-faint">{recent.path}</span>
        </span>
        {chord && (
          <span className="flex shrink-0 items-center gap-0.5">
            {chordLabels(chord, isMac).map((label, index) => (
              <Kbd key={index}>{label}</Kbd>
            ))}
          </span>
        )}
      </DropdownMenuItem>
    );
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
              {repo.isWorktree ? ' · worktree' : ''}
              {assignedProfile ? ` · ${assignedProfile.label}` : ''}
            </span>
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="flex max-h-[min(70vh,var(--radix-dropdown-menu-content-available-height))] min-w-72 flex-col"
      >
        {groups.length === 0 && <DropdownMenuLabel>Repositories</DropdownMenuLabel>}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {groups.length === 0
            ? recents.map(renderRecent)
            : [
                ...grouped.sections
                  .filter((section) => section.repos.length > 0)
                  .map((section) => (
                    <div key={section.group.id} data-switcher-group={section.group.name}>
                      <DropdownMenuLabel className="flex items-center gap-1.5">
                        <GroupDot color={section.group.color} className="-ml-1" />
                        <span className="truncate">{section.group.name}</span>
                      </DropdownMenuLabel>
                      {section.repos.map(renderRecent)}
                    </div>
                  )),
                grouped.ungrouped.length > 0 && (
                  <div key="ungrouped" data-switcher-group="Other">
                    <DropdownMenuLabel>Other</DropdownMenuLabel>
                    {grouped.ungrouped.map(renderRecent)}
                  </div>
                ),
              ]}
        </div>
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

function isNonFastForward(error: unknown): boolean {
  const e = error as { code?: string; message?: string } | null;
  return e?.code === 'non_fast_forward' || /non-fast-?forward/i.test(e?.message ?? '');
}

export function Toolbar({ onRefresh }: { onRefresh: () => Promise<void> }) {
  const repo = useRepo((s) => s.repo);
  const status = useRepo((s) => s.status);
  const remotes = useRepo((s) => s.remotes);
  const stashes = useRepo((s) => s.stashes);
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
  const latestStash = stashes[0];

  const editorId = useSettings((s) => s.editorId);
  const { editors } = useEditors();
  const editor = preferredEditor(editors, editorId);

  const [pushRejected, setPushRejected] = useState(false);

  const run = async (label: string, op: () => Promise<{ status: string; message: string } | void>) => {
    if (busy) return;
    setBusy(label);
    try {
      const outcome = await op();
      if (label.startsWith('Pull') && useRepo.getState().repo?.path === repo.path) useRepo.getState().markFetched();
      if (outcome && 'message' in outcome) {
        toastOutcome(outcome, `${label} complete`);
      } else {
        toast.success(`${label} complete`);
      }
      await onRefresh();
    } catch (error) {
      if (label === 'Push' && isNonFastForward(error)) {
        setPushRejected(true);
        return;
      }
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
      void import('@/features/forge/store').then(({ useForge }) => useForge.getState().load(true));
    })();
  const confirmForcePush = async () => {
    const branch = repo.headBranch ?? 'the current branch';
    const ok = await confirmDialog({
      title: 'Force push?',
      description: `${remote}/${branch} will be replaced with your local ${branch}. Commits that exist only on the remote are lost, and anyone who pulled the branch will need to reset to it.`,
      confirmLabel: 'Force push',
      destructive: true,
    });
    if (ok) runPush('Push (force)', () => ipc.push(repo.path, remote, true, false, true));
  };

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

      <PushRejectedDialog
        open={pushRejected}
        remote={remote}
        branch={repo.headBranch ?? null}
        onClose={() => setPushRejected(false)}
        onPullRebase={() => {
          setPushRejected(false);
          void run('Pull (rebase)', () => ipc.pull(repo.path, remote, 'rebase'));
        }}
        onForcePush={() => {
          setPushRejected(false);
          runPush('Push (force)', () => ipc.push(repo.path, remote, true, false, true));
        }}
      />

      <Separator orientation="vertical" className="mx-2 h-6" />

      <Hint label={remotes.length === 0 ? 'No remotes configured' : remotes.length > 1 ? `Fetch all remotes (${remotes.map((r) => r.name).join(', ')})` : `Fetch ${remote}`}>
        <span className="inline-flex">
          <Button
            variant="ghost"
            size="sm"
            disabled={!!busy || remotes.length === 0}
            onClick={() =>
              void run('Fetch', async () => {
                const result = await fetchRemotes(remotes.map((r) => r.name), (name) => ipc.fetch(repo.path, name, true, true));
                const message = fetchResultMessage(result);
                if (useRepo.getState().repo?.path === repo.path) {
                  if (result.succeeded.length > 0) useRepo.getState().markFetched();
                  useRepo.getState().setFetchFailures(result.failed.map(({ name }) => name));
                }
                return { status: result.succeeded.length === 0 ? 'failed' : result.failed.length > 0 ? 'partial' : 'ok', message };
              })
            }
          >
            <RefreshCw className={busy === 'Fetch' ? 'animate-spin' : ''} />
            Fetch
          </Button>
        </span>
      </Hint>
      <div className="flex items-center">
        <Hint label={`Pull from ${remote}${status?.behind ? ` (${status.behind} behind)` : ''} · merge or rebase per pull.rebase`}>
          <Button
            variant="ghost"
            size="sm"
            className="rounded-r-none"
            disabled={!!busy}
            onClick={() => void run('Pull', () => ipc.pull(repo.path, remote))}
          >
            <ArrowDownToLine />
            Pull
            {status && status.behind > 0 && <Badge tone="info">{capCount(status.behind)}</Badge>}
          </Button>
        </Hint>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" className="rounded-l-none" aria-label="Pull options" disabled={!!busy}>
              <ChevronDown className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onClick={() => void run('Pull (merge)', () => ipc.pull(repo.path, remote, 'merge'))}>
              Pull with merge
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => void run('Pull (rebase)', () => ipc.pull(repo.path, remote, 'rebase'))}>
              Pull with rebase
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
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
            <DropdownMenuItem onClick={() => void confirmForcePush()} destructive>
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
      <Hint label={latestStash ? `Pop latest stash: ${latestStash.message}` : 'Pop latest stash (nothing stashed)'}>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Pop latest stash"
          disabled={!latestStash || !!busy}
          onClick={() => void run('Pop stash', () => ipc.stashPop(repo.path, 0))}
        >
          <ArchiveRestore />
        </Button>
      </Hint>

      <Separator orientation="vertical" className="mx-2 h-6" />

      <div className="flex items-center">
        <Hint label={editor ? `Open in ${editor.label}` : 'Open in editor (none detected, see Settings → Git)'}>
          <Button
            variant="ghost"
            size="icon"
            className="rounded-r-none"
            aria-label={editor ? `Open in ${editor.label}` : 'Open in editor'}
            disabled={!editor}
            onClick={() => editor && void openInEditor(editor.id, repo.path)}
          >
            <Code />
          </Button>
        </Hint>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="rounded-l-none"
              aria-label="Editor options"
              disabled={editors.length === 0}
            >
              <ChevronDown className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {editors.map((candidate) => (
              <DropdownMenuItem key={candidate.id} onClick={() => void openInEditor(candidate.id, repo.path)}>
                {candidate.id === editor?.id ? <Check /> : <Code />} Open in {candidate.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

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
