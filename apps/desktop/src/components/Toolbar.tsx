import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
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
  RefreshCw,
  Settings,
  SquareTerminal,
  Tag,
  Archive,
} from 'lucide-react';
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Hint,
  Kbd,
  Logo,
  Separator,
  Spinner,
  cn,
} from '@angkorgit/design-system';
import { ipc, pickDirectory } from '@/core/ipc';
import { useRepo } from '@/features/repository/store';
import { useUi } from '@/features/ui/store';
import { modKey } from '@/shared/utils';

/** GitKraken-style project switcher: the repo name is a dropdown. */
function RepoSwitcher() {
  const { repo, recents, open, busy } = useRepo();
  const openDialog = useUi((s) => s.openDialog);
  if (!repo) return null;

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
              {repo.state !== 'clean' && (
                <Badge tone="danger" className="ml-2">
                  {repo.state}
                </Badge>
              )}
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Toolbar({ onRefresh }: { onRefresh: () => Promise<void> }) {
  const { repo, status, remotes, busy, setBusy } = useRepo();
  const { toggleTerminal, toggleSidebar, sidebarOpen, openDialog, setPaletteOpen } = useUi();
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
        if (outcome.status === 'conflicts') toast.warning(outcome.message);
        else toast.success(outcome.message);
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
          {status && status.behind > 0 && <Badge tone="info">{status.behind}</Badge>}
        </Button>
      </Hint>
      <div className="flex items-center">
        <Hint label={`Push to ${remote}${status?.ahead ? ` (${status.ahead} ahead)` : ''}`}>
          <Button
            variant="ghost"
            size="sm"
            className="rounded-r-none"
            disabled={!!busy}
            onClick={() => void run('Push', () => ipc.push(repo.path, remote, false, false, true))}
          >
            <ArrowUpFromLine />
            Push
            {status && status.ahead > 0 && <Badge tone="primary">{status.ahead}</Badge>}
          </Button>
        </Hint>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" className="rounded-l-none" aria-label="Push options" disabled={!!busy}>
              <ChevronDown className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onClick={() => void run('Push (force)', () => ipc.push(repo.path, remote, true, false, true))} destructive>
              Force push
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => void run('Push with tags', () => ipc.push(repo.path, remote, false, true, true))}>
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
