import { useEffect, useMemo, useState } from 'react';
import { Command } from 'cmdk';
import { toast } from 'sonner';
import { toastOutcome } from '@/shared/toastOutcome';
import {
  Archive,
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  FileClock,
  FolderGit2,
  GitBranchPlus,
  History,
  Moon,
  PanelLeft,
  RefreshCw,
  Settings,
  SquareTerminal,
  Sun,
  Tag as TagIcon,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { Kbd } from '@angkorgit/design-system';
import { ipc } from '@/core/ipc';
import { useRepo } from '@/features/repository/store';
import { useUi } from '@/features/ui/store';
import { themeBase, useSettings } from '@/features/settings/store';
import { useUndo } from '@/features/history/undoStore';
import { modKey } from '@/shared/utils';

export function CommandPalette({ onRefresh }: { onRefresh: () => Promise<void> }) {
  const repo = useRepo((s) => s.repo);
  const branches = useRepo((s) => s.branches);
  const remotes = useRepo((s) => s.remotes);
  const recents = useRepo((s) => s.recents);
  const open = useRepo((s) => s.open);
  const paletteOpen = useUi((s) => s.paletteOpen);
  const setPaletteOpen = useUi((s) => s.setPaletteOpen);
  const toggleTerminal = useUi((s) => s.toggleTerminal);
  const toggleSidebar = useUi((s) => s.toggleSidebar);
  const sidebarOpen = useUi((s) => s.sidebarOpen);
  const openDialog = useUi((s) => s.openDialog);
  const theme = useSettings((s) => s.theme);
  const setTheme = useSettings((s) => s.setTheme);
  const zoomIn = useSettings((s) => s.zoomIn);
  const zoomOut = useSettings((s) => s.zoomOut);

  const path = repo?.path ?? '';
  const remote = remotes[0]?.name ?? 'origin';
  const locals = useMemo(() => branches.filter((b) => !b.isRemote && !b.isHead), [branches]);
  const otherRepos = useMemo(() => recents.filter((r) => r.path !== path).slice(0, 8), [recents, path]);

  const [mode, setMode] = useState<'commands' | 'fileHistory'>('commands');
  const [search, setSearch] = useState('');
  const [files, setFiles] = useState<string[]>([]);

  useEffect(() => {
    if (!paletteOpen) return;
    setMode('commands');
    setSearch('');
  }, [paletteOpen]);

  const enterFileHistory = () => {
    setMode('fileHistory');
    setSearch('');
    void ipc
      .repoFiles(path)
      .then(setFiles)
      .catch(() => setFiles([]));
  };

  const visibleFiles = useMemo(() => {
    if (mode !== 'fileHistory') return [];
    const q = search.trim().toLowerCase();
    const matches = q ? files.filter((f) => f.toLowerCase().includes(q)) : files;
    return matches.slice(0, 50);
  }, [mode, files, search]);

  const close = () => setPaletteOpen(false);

  const run = (label: string, op: () => Promise<unknown>) => {
    close();
    void (async () => {
      try {
        const result = (await op()) as { status?: string; message?: string } | undefined;
        toastOutcome(result, `${label} done`);
        await onRefresh();
      } catch (error) {
        toast.error(`${label} failed: ${(error as { message?: string }).message ?? error}`);
      }
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
            : 'Type a command or branch name…'
        }
        onKeyDown={(e) => {
          if (mode === 'fileHistory' && e.key === 'Backspace' && search === '') {
            e.preventDefault();
            setMode('commands');
          }
        }}
        className="h-11 w-full border-b border-border-subtle bg-transparent px-4 text-sm text-foreground outline-none placeholder:text-faint"
      />
      <Command.List className="max-h-80 overflow-y-auto p-1.5 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-faint">
        <Command.Empty className="py-8 text-center text-sm text-faint">No results.</Command.Empty>

        {mode === 'fileHistory' && (
          <Command.Group heading="File history">
            {visibleFiles.map((file) => (
              <PaletteItem
                key={file}
                icon={<FileClock />}
                label={file}
                onSelect={() => {
                  close();
                  useUi.getState().openFileHistory(file);
                }}
              />
            ))}
          </Command.Group>
        )}

        {mode === 'commands' && (
        <>
        <Command.Group heading="Actions">
          <PaletteItem icon={<History />} label="File history…" onSelect={enterFileHistory} />
          <PaletteItem icon={<ArrowDownToLine />} label="Pull" onSelect={() => run('Pull', () => ipc.pull(path, remote))} />
          <PaletteItem icon={<ArrowUpFromLine />} label="Push" onSelect={() => run('Push', () => ipc.push(path, remote, false, false, true))} />
          <PaletteItem icon={<RefreshCw />} label="Fetch (with tags)" onSelect={() => run('Fetch', () => ipc.fetch(path, remote, true, true))} />
          <PaletteItem
            icon={<GitBranchPlus />}
            label="Create branch…"
            onSelect={() => {
              close();
              openDialog('createBranch');
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
        </Command.Group>

        {otherRepos.length > 0 && (
          <Command.Group heading="Switch repository">
            {otherRepos.map((recent) => (
              <PaletteItem
                key={recent.path}
                icon={<FolderGit2 />}
                label={recent.name}
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
          {locals.map((branch) => (
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
        </Command.Group>
        </>
        )}
      </Command.List>
    </Command.Dialog>
  );
}

function PaletteItem({
  icon,
  label,
  shortcut,
  onSelect,
}: {
  icon: React.ReactNode;
  label: string;
  shortcut?: string;
  onSelect: () => void;
}) {
  return (
    <Command.Item
      onSelect={onSelect}
      className="flex cursor-default select-none items-center gap-2.5 rounded-md px-2 py-2 text-sm text-foreground data-[selected=true]:bg-surface-raised [&_svg]:size-4 [&_svg]:text-muted"
    >
      {icon}
      <span className="flex-1">{label}</span>
      {shortcut && (
        <span className="flex items-center gap-0.5">
          <Kbd>{modKey()}</Kbd>
          <Kbd>{shortcut}</Kbd>
        </span>
      )}
    </Command.Item>
  );
}
