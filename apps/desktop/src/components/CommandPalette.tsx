import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Command } from 'cmdk';
import { toast } from 'sonner';
import { toastOutcome } from '@/shared/toastOutcome';
import { fetchRemotes, fetchResultMessage } from '@/features/repository/fetchRemotes';
import {
  Archive,
  ArchiveRestore,
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  ChevronsDownUp,
  Code,
  Download,
  FileClock,
  FolderGit2,
  FolderOpen,
  FolderTree,
  Folders,
  GitBranchPlus,
  GitPullRequest,
  Globe,
  History,
  Home,
  Moon,
  PanelLeft,
  Redo2,
  RefreshCw,
  Settings,
  SquareTerminal,
  Sun,
  Tag as TagIcon,
  Undo2,
  UserRoundSearch,
  ZoomIn,
  ZoomOut,
  Keyboard,
} from 'lucide-react';
import { Kbd, Spinner } from '@angkorgit/design-system';
import { ipc, openExternal, pickDirectory } from '@/core/ipc';
import { confirmDialog } from '@/components/confirm';
import { useRepo } from '@/features/repository/store';
import { abortMergeFlow } from '@/features/repository/merge';
import { sidebarVisible, useUi } from '@/features/ui/store';
import { SIDEBAR_SECTIONS } from '@/features/sidebar/Sidebar';
import { themeBase, useSettings } from '@/features/settings/store';
import { installCliTool } from '@/features/settings/cliTool';
import { openInEditor, preferredEditor, useEditors } from '@/features/settings/editors';
import { useUndo } from '@/features/history/undoStore';
import { useForge } from '@/features/forge/store';
import { chordLabels, forgeNoun, groupRepos, parseChordId, pickForgeRemote, remoteWebUrl, repoGroupIdFor } from '@angkorgit/core';
import { closeRepoGroup, openRepoGroup, plural } from '@/features/repository/groups';
import { currentPullRequestUrl, isMac, modKey } from '@/shared/utils';

export function CommandPalette({ onRefresh }: { onRefresh: () => Promise<void> }) {
  const repo = useRepo((s) => s.repo);
  const editorId = useSettings((s) => s.editorId);
  const repoShortcuts = useSettings((s) => s.repoShortcuts);
  const repoGroups = useSettings((s) => s.repoGroups);
  const repoGroupOf = useSettings((s) => s.repoGroupOf);
  const worktreeMains = useUi((s) => s.worktreeMains);
  const repoTabs = useUi((s) => s.repoTabs);
  const { editors } = useEditors();
  const editor = preferredEditor(editors, editorId);
  const branches = useRepo((s) => s.branches);
  const remotes = useRepo((s) => s.remotes);
  const recents = useRepo((s) => s.recents);
  const worktrees = useRepo((s) => s.worktrees);
  const stashes = useRepo((s) => s.stashes);
  const open = useRepo((s) => s.open);
  const paletteOpen = useUi((s) => s.paletteOpen);
  const setPaletteOpen = useUi((s) => s.setPaletteOpen);
  const toggleTerminal = useUi((s) => s.toggleTerminal);
  const toggleSidebar = useUi((s) => s.toggleSidebar);
  const sidebarOpen = useUi(sidebarVisible);
  const openDialog = useUi((s) => s.openDialog);
  const theme = useSettings((s) => s.theme);
  const setTheme = useSettings((s) => s.setTheme);
  const zoomIn = useSettings((s) => s.zoomIn);
  const zoomOut = useSettings((s) => s.zoomOut);
  const forgeRepoPath = useForge((s) => s.repoPath);
  const forgeKind = useForge((s) => s.remote?.kind ?? null);
  const forgeAccount = useForge((s) => s.hasAccount);
  const undoStack = useUndo((s) => s.undoStack);
  const redoStack = useUndo((s) => s.redoStack);
  const navigate = useNavigate();

  const path = repo?.path ?? '';
  const repoState = repo?.state ?? 'clean';
  const remote = remotes[0]?.name ?? 'origin';
  const locals = useMemo(() => branches.filter((b) => !b.isRemote && !b.isHead), [branches]);
  const otherRepos = useMemo(() => recents.filter((r) => r.path !== path).slice(0, 8), [recents, path]);
  const groupSections = useMemo(
    () => groupRepos(recents, repoGroups, repoGroupOf, worktreeMains).sections.filter((s) => s.repos.length > 0),
    [recents, repoGroups, repoGroupOf, worktreeMains],
  );
  const groupNameOf = (repoPath: string): string | undefined => {
    const id = repoGroupIdFor(repoPath, repoGroupOf, worktreeMains);
    return id ? repoGroups.find((g) => g.id === id)?.name : undefined;
  };
  const nextUndo = useMemo(() => [...undoStack].reverse().find((e) => e.repoPath === path), [undoStack, path]);
  const nextRedo = useMemo(() => [...redoStack].reverse().find((e) => e.repoPath === path), [redoStack, path]);

  const [mode, setMode] = useState<'commands' | 'fileHistory' | 'blame'>('commands');
  const [search, setSearch] = useState('');
  const [files, setFiles] = useState<string[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesError, setFilesError] = useState(false);
  const filesRequest = useRef(0);

  useEffect(() => {
    if (!paletteOpen) return;
    setMode('commands');
    setSearch('');
  }, [paletteOpen]);

  const enterFilePicker = (picker: 'fileHistory' | 'blame') => {
    setMode(picker);
    setSearch('');
    setFiles([]);
    setFilesError(false);
    setFilesLoading(true);
    const token = ++filesRequest.current;
    void ipc
      .repoFiles(path)
      .then((list) => {
        if (filesRequest.current !== token) return;
        setFiles(list);
        setFilesLoading(false);
      })
      .catch((error) => {
        if (filesRequest.current !== token) return;
        setFiles([]);
        setFilesError(true);
        setFilesLoading(false);
        toast.error(`Listing files failed: ${(error as { message?: string }).message ?? error}`);
      });
  };

  const visibleFiles = useMemo(() => {
    if (mode === 'commands') return [];
    const q = search.trim().toLowerCase();
    const matches = q ? files.filter((f) => f.toLowerCase().includes(q)) : files;
    return matches.slice(0, 50);
  }, [mode, files, search]);

  const visibleBranches = useMemo(() => {
    if (mode !== 'commands') return [];
    const q = search.trim().toLowerCase();
    const matches = q ? locals.filter((b) => b.name.toLowerCase().includes(q)) : locals;
    return matches.slice(0, 100);
  }, [mode, locals, search]);

  const close = () => setPaletteOpen(false);

  const run = (label: string, op: () => Promise<unknown>) => {
    close();
    void (async () => {
      try {
        const result = (await op()) as { status?: string; message?: string } | undefined;
        if (label.startsWith('Pull') && useRepo.getState().repo?.path === path) useRepo.getState().markFetched();
        toastOutcome(result, `${label} done`);
        await onRefresh();
      } catch (error) {
        toast.error(`${label} failed: ${(error as { message?: string }).message ?? error}`);
      }
    })();
  };

  const runHistory = (direction: 'undo' | 'redo') => {
    close();
    const fn = direction === 'undo' ? useUndo.getState().undo : useUndo.getState().redo;
    void fn(path).then((ok) => {
      if (ok) void onRefresh();
    });
  };

  const openRepository = () => {
    close();
    void (async () => {
      const dir = await pickDirectory('Open a Git repository');
      if (!dir || dir === path) return;
      await open(dir);
    })().catch((error) =>
      toast.error(`Could not open: ${(error as { message?: string }).message ?? error}`),
    );
  };

  const continueRebase = () => {
    close();
    void (async () => {
      try {
        const outcome = await ipc.rebaseContinue(path);
        toastOutcome(outcome, 'Rebase continued');
      } catch (error) {
        toast.error(`Continue failed: ${(error as { message?: string }).message ?? error}`);
      }
      await onRefresh();
    })();
  };

  const abortRebase = () => {
    close();
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
      await onRefresh();
    })();
  };

  const abortMerge = () => {
    close();
    void abortMergeFlow(path);
  };

  const clearState = () => {
    close();
    void (async () => {
      const ok = await confirmDialog({
        title: `Clear ${repoState} state?`,
        description:
          `Git still marks this repository as mid-${repoState}. Clearing removes that marker and keeps every file and commit exactly as it is now. Use this when the ${repoState} is already finished.`,
        confirmLabel: 'Clear state',
      });
      if (!ok) return;
      try {
        await ipc.stateCleanup(path);
        toast.success('State cleared');
      } catch (error) {
        toast.error(`Clear failed: ${(error as { message?: string }).message ?? error}`);
      }
      await onRefresh();
    })();
  };

  return (
    <Command.Dialog
      open={paletteOpen}
      onOpenChange={setPaletteOpen}
      label="Command palette"
      shouldFilter={mode === 'commands'}
      className="fixed left-1/2 top-24 z-50 w-full max-w-lg -translate-x-1/2 overflow-hidden rounded-lg border border-border bg-surface-overlay shadow-soft"
    >
      <Command.Input
        value={search}
        onValueChange={setSearch}
        placeholder={
          mode === 'fileHistory'
            ? 'Search a file to see who changed it…'
            : mode === 'blame'
              ? 'Search a file to blame…'
              : 'Type a command or branch name…'
        }
        onKeyDown={(e) => {
          if (mode !== 'commands' && e.key === 'Backspace' && search === '') {
            e.preventDefault();
            setMode('commands');
          }
        }}
        className="h-11 w-full border-b border-border-subtle bg-transparent px-4 text-sm text-foreground outline-none placeholder:text-faint"
      />
      <Command.List className="max-h-80 overflow-y-auto p-1.5 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-faint">
        {!(mode !== 'commands' && (filesLoading || filesError)) && (
          <Command.Empty className="py-8 text-center text-sm text-faint">No results.</Command.Empty>
        )}

        {mode !== 'commands' && filesLoading && (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-faint">
            <Spinner /> Loading files…
          </div>
        )}
        {mode !== 'commands' && !filesLoading && filesError && (
          <div className="py-8 text-center text-sm text-faint">Could not list files.</div>
        )}
        {mode !== 'commands' && !filesLoading && !filesError && (
          <Command.Group heading={mode === 'blame' ? 'Blame' : 'File history'}>
            {visibleFiles.map((file) => (
              <PaletteItem
                key={file}
                icon={mode === 'blame' ? <UserRoundSearch /> : <FileClock />}
                label={file}
                onSelect={() => {
                  close();
                  if (mode === 'blame') useUi.getState().openBlame(file);
                  else useUi.getState().openFileHistory(file);
                }}
              />
            ))}
          </Command.Group>
        )}

        {mode === 'commands' && (
        <>
        <Command.Group heading="Actions">
          <PaletteItem icon={<History />} label="File history…" onSelect={() => enterFilePicker('fileHistory')} />
          <PaletteItem icon={<UserRoundSearch />} label="Blame…" onSelect={() => enterFilePicker('blame')} />
          <PaletteItem icon={<ArrowDownToLine />} label="Pull" onSelect={() => run('Pull', () => ipc.pull(path, remote))} />
          <PaletteItem
            icon={<ArrowDownToLine />}
            label="Pull with rebase"
            onSelect={() => run('Pull (rebase)', () => ipc.pull(path, remote, 'rebase'))}
          />
          <PaletteItem icon={<ArrowUpFromLine />} label="Push" onSelect={() => run('Push', () => ipc.push(path, remote, false, false, true))} />
          {(() => {
            const headUpstream = branches.find((b) => !b.isRemote && b.isHead)?.upstream ?? null;
            const pickedRemote = pickForgeRemote(remotes, headUpstream);
            const prUrl = currentPullRequestUrl(repo, pickedRemote?.url);
            const webUrl = pickedRemote ? remoteWebUrl(pickedRemote.url) : null;
            const forgeCurrent = forgeRepoPath !== null && forgeRepoPath === repo?.path;
            const inApp = forgeCurrent && forgeKind !== null && forgeAccount;
            return (
              <>
                {webUrl && (
                  <PaletteItem
                    icon={<Globe />}
                    label={remotes.length > 1 ? `Open ${pickedRemote?.name} in browser` : 'Open repository in browser'}
                    onSelect={() => {
                      close();
                      void openExternal(webUrl);
                    }}
                  />
                )}
                {prUrl && (
                  <PaletteItem
                    icon={<GitPullRequest />}
                    label={`Create ${forgeNoun(forgeCurrent ? forgeKind : null)}`}
                    onSelect={() => {
                      close();
                      if (inApp) openDialog('createPullRequest');
                      else void openExternal(prUrl);
                    }}
                  />
                )}
              </>
            );
          })()}
          <PaletteItem
            icon={<RefreshCw />}
            label={remotes.length > 1 ? 'Fetch all remotes (with tags)' : 'Fetch (with tags)'}
            onSelect={() =>
              run('Fetch', async () => {
                const result = await fetchRemotes(remotes.map((r) => r.name), (name) => ipc.fetch(path, name, true, true));
                const message = fetchResultMessage(result);
                if (useRepo.getState().repo?.path === path) {
                  if (result.succeeded.length > 0) useRepo.getState().markFetched();
                  useRepo.getState().setFetchFailures(result.failed.map(({ name }) => name));
                }
                return { status: result.succeeded.length === 0 ? 'failed' : result.failed.length > 0 ? 'partial' : 'ok', message };
              })
            }
          />
          <PaletteItem
            icon={<GitBranchPlus />}
            label="Create branch…"
            onSelect={() => {
              close();
              openDialog('createBranch');
            }}
          />
          <PaletteItem
            icon={<FolderTree />}
            label="New worktree…"
            onSelect={() => {
              close();
              openDialog('createWorktree');
            }}
          />
          <PaletteItem
            icon={<TagIcon />}
            label="Create tag…"
            onSelect={() => {
              close();
              openDialog('createTag');
            }}
          />
          <PaletteItem
            icon={<Archive />}
            label="Stash changes…"
            onSelect={() => {
              close();
              openDialog('createStash');
            }}
          />
          {stashes.length > 0 && (
            <PaletteItem
              icon={<ArchiveRestore />}
              label={`Pop latest stash: ${stashes[0].message}`}
              onSelect={() => run('Pop stash', () => ipc.stashPop(path, 0))}
            />
          )}
          {nextUndo && (
            <PaletteItem icon={<Undo2 />} label={`Undo: ${nextUndo.label}`} shortcut="Z" onSelect={() => runHistory('undo')} />
          )}
          {nextRedo && (
            <PaletteItem icon={<Redo2 />} label={`Redo: ${nextRedo.label}`} onSelect={() => runHistory('redo')} />
          )}
          <PaletteItem
            icon={<RefreshCw />}
            label="Refresh"
            shortcut="R"
            onSelect={() => {
              close();
              void onRefresh();
            }}
          />
        </Command.Group>

        {repoState !== 'clean' && (
          <Command.Group heading="Repository state">
            {repoState === 'rebase' && (
              <>
                <PaletteItem icon={<Redo2 />} label="Continue rebase" onSelect={continueRebase} />
                <PaletteItem icon={<Undo2 />} label="Abort rebase" onSelect={abortRebase} />
              </>
            )}
            {repoState === 'merge' && (
              <PaletteItem icon={<Undo2 />} label="Abort merge" onSelect={abortMerge} />
            )}
            <PaletteItem icon={<Check />} label="Clear repository state" onSelect={clearState} />
          </Command.Group>
        )}

        <Command.Group heading="Repository">
          <PaletteItem icon={<FolderOpen />} label="Open repository…" onSelect={openRepository} />
          <PaletteItem
            icon={<GitBranchPlus />}
            label="Clone repository…"
            onSelect={() => {
              close();
              openDialog('clone');
            }}
          />
          <PaletteItem
            icon={<Home />}
            label="Back to repositories"
            onSelect={() => {
              close();
              navigate('/welcome');
            }}
          />
        </Command.Group>

        {worktrees.some((w) => !w.isCurrent && !w.isMissing) && (
          <Command.Group heading="Switch worktree">
            {worktrees
              .filter((w) => !w.isCurrent && !w.isMissing)
              .map((w) => (
                <PaletteItem
                  key={w.path}
                  icon={<FolderTree />}
                  label={`${w.name}${w.branch ? ` · ${w.branch}` : ''}`}
                  onSelect={() => {
                    close();
                    void open(w.path).catch((error) =>
                      toast.error(`Could not open worktree: ${(error as { message?: string }).message ?? error}`),
                    );
                  }}
                />
              ))}
          </Command.Group>
        )}

        {groupSections.length > 0 && (
          <Command.Group heading="Repository groups">
            {groupSections.map((section) => {
              const paths = section.repos.map((r) => r.path);
              const openCount = paths.filter((p) => repoTabs.includes(p)).length;
              return [
                <PaletteItem
                  key={`open:${section.group.id}`}
                  icon={<Folders />}
                  label={`Open all in ${section.group.name}`}
                  detail={plural(paths.length, 'repository')}
                  keywords={[section.group.name, 'group', 'tabs']}
                  onSelect={() => {
                    close();
                    void openRepoGroup(section.group, paths);
                  }}
                />,
                openCount > 0 && (
                  <PaletteItem
                    key={`close:${section.group.id}`}
                    icon={<Folders />}
                    label={`Close all in ${section.group.name}`}
                    detail={`${openCount} open`}
                    keywords={[section.group.name, 'group', 'tabs']}
                    onSelect={() => {
                      close();
                      closeRepoGroup(section.group, paths);
                    }}
                  />
                ),
              ];
            })}
          </Command.Group>
        )}

        {otherRepos.length > 0 && (
          <Command.Group heading="Switch repository">
            {otherRepos.map((recent) => (
              <PaletteItem
                key={recent.path}
                icon={<FolderGit2 />}
                label={recent.name}
                detail={groupNameOf(recent.path)}
                keywords={groupNameOf(recent.path) ? [groupNameOf(recent.path)!] : undefined}
                keys={repoShortcuts[recent.path] ? chordLabels(parseChordId(repoShortcuts[recent.path])!, isMac) : undefined}
                onSelect={() => {
                  close();
                  void open(recent.path).catch((error) =>
                    toast.error(`Could not open: ${(error as { message?: string }).message ?? error}`),
                  );
                }}
              />
            ))}
          </Command.Group>
        )}

        <Command.Group heading="Checkout branch">
          {visibleBranches.map((branch) => (
            <PaletteItem
              key={branch.name}
              icon={<Check />}
              label={branch.name}
              onSelect={() =>
                run(`Checkout ${branch.name}`, () =>
                  useUndo.getState().tracked({
                    path,
                    kind: 'checkout',
                    label: `Checkout ${branch.name}`,
                    action: () => ipc.checkout(path, branch.name),
                  }),
                )
              }
            />
          ))}
        </Command.Group>

        <Command.Group heading="View">
          <PaletteItem
            icon={<SquareTerminal />}
            label="Toggle terminal"
            shortcut="`"
            onSelect={() => {
              close();
              toggleTerminal();
            }}
          />
          <PaletteItem
            icon={<PanelLeft />}
            label={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
            shortcut="B"
            onSelect={() => {
              close();
              toggleSidebar();
            }}
          />
          <PaletteItem
            icon={<ChevronsDownUp />}
            label="Collapse sidebar sections"
            onSelect={() => {
              close();
              useUi.getState().collapseSidebarSections(SIDEBAR_SECTIONS);
            }}
          />
          <PaletteItem
            icon={<ZoomIn />}
            label="Zoom in"
            shortcut="+"
            onSelect={() => {
              close();
              zoomIn();
            }}
          />
          <PaletteItem
            icon={<ZoomOut />}
            label="Zoom out"
            shortcut="-"
            onSelect={() => {
              close();
              zoomOut();
            }}
          />
          <PaletteItem
            icon={themeBase(theme) === 'dark' ? <Sun /> : <Moon />}
            label={themeBase(theme) === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            onSelect={() => {
              close();
              setTheme(themeBase(theme) === 'dark' ? 'light' : 'dark');
            }}
          />
          <PaletteItem
            icon={<Settings />}
            label="Settings"
            shortcut=","
            onSelect={() => {
              close();
              openDialog('settings');
            }}
          />
          <PaletteItem
            icon={<Keyboard />}
            label="Keyboard shortcut for this repository…"
            keys={repoShortcuts[path] ? chordLabels(parseChordId(repoShortcuts[path])!, isMac) : undefined}
            onSelect={() => {
              close();
              openDialog('repoShortcut', { repoPath: path });
            }}
          />
          <PaletteItem
            icon={<SquareTerminal />}
            label="Install command line tool"
            onSelect={() => {
              close();
              void installCliTool().catch((error) =>
                toast.error(
                  `Could not install: ${(error as { message?: string }).message ?? error}`,
                ),
              );
            }}
          />
          {repo && editor && (
            <PaletteItem
              icon={<Code />}
              label={`Open repository in ${editor.label}`}
              onSelect={() => {
                close();
                void openInEditor(editor.id, repo.path);
              }}
            />
          )}
          <PaletteItem
            icon={<Download />}
            label="Check for updates"
            onSelect={() => {
              close();
              void import('@/features/updater/check').then(({ checkForUpdates }) =>
                checkForUpdates({ silent: false }),
              );
            }}
          />
        </Command.Group>
        </>
        )}
      </Command.List>
      <div className="flex items-center gap-4 border-t border-border-subtle px-3 py-1.5 text-[10px] text-faint">
        <span className="flex items-center gap-1">
          <Kbd>↑↓</Kbd> move
        </span>
        <span className="flex items-center gap-1">
          <Kbd>⏎</Kbd> run
        </span>
        <span className="flex items-center gap-1">
          <Kbd>esc</Kbd> {mode === 'commands' ? 'close' : 'back'}
        </span>
      </div>
    </Command.Dialog>
  );
}

function PaletteItem({
  icon,
  label,
  detail,
  shortcut,
  keys,
  keywords,
  onSelect,
}: {
  icon: React.ReactNode;
  label: string;
  detail?: string;
  shortcut?: string;
  keys?: string[];
  keywords?: string[];
  onSelect: () => void;
}) {
  return (
    <Command.Item
      onSelect={onSelect}
      keywords={keywords}
      className="flex cursor-default select-none items-center gap-2.5 rounded-md px-2 py-2 text-sm text-foreground data-[selected=true]:bg-surface-raised [&_svg]:size-4 [&_svg]:text-muted"
    >
      {icon}
      <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
        <span className="truncate">{label}</span>
        {detail && <span className="shrink-0 text-xs text-faint">{detail}</span>}
      </span>
      {shortcut && (
        <span className="flex items-center gap-0.5">
          <Kbd>{modKey()}</Kbd>
          <Kbd>{shortcut}</Kbd>
        </span>
      )}
      {keys && (
        <span className="flex items-center gap-0.5">
          {keys.map((key, index) => (
            <Kbd key={index}>{key}</Kbd>
          ))}
        </span>
      )}
    </Command.Item>
  );
}
