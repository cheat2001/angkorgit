import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { motion } from 'framer-motion';
import { useRepo } from './store';
import { useGraph } from '@/features/graph/store';
import { sidebarVisible, useUi } from '@/features/ui/store';
import { RepoTabs } from '@/components/RepoTabs';
import { StatusBar } from '@/components/StatusBar';
import { Toolbar } from '@/components/Toolbar';
import { Sidebar } from '@/features/sidebar/Sidebar';
import { CommitGraph } from '@/features/graph/CommitGraph';
import { InteractiveRebaseDialog } from '@/features/graph/InteractiveRebaseDialog';
import { DiffPanel } from '@/features/diff/DiffPanel';
import { EditorPanel, editorCloseShortcut } from '@/features/editor/EditorPanel';
import { commitShortcut } from '@/features/commit/WorkingCopyPanel';
import { FileHistoryPanel } from '@/features/history/FileHistoryPanel';
import { Inspector } from '@/features/inspector/Inspector';
const TerminalPanel = lazy(() =>
  import('@/features/terminal/TerminalPanel').then((m) => ({ default: m.TerminalPanel })),
);
import { CommandPalette } from '@/components/CommandPalette';
const ConflictResolver = lazy(() =>
  import('@/features/conflicts/ConflictResolver').then((m) => ({ default: m.ConflictResolver })),
);
import { SettingsDialog } from '@/features/settings/SettingsDialog';
import { RepoDialogs } from './RepoDialogs';
import { CloneDialog } from './CloneDialog';
import { CreatePrDialog } from '@/features/forge/CreatePrDialog';
import { CreateWorktreeDialog } from '@/features/worktrees/CreateWorktreeDialog';
import { useForge } from '@/features/forge/store';
import { useShortcuts } from '@/shared/useShortcuts';
import { useUndo } from '@/features/history/undoStore';
import { useSettings } from '@/features/settings/store';
import { ipc, listen } from '@/core/ipc';
import { Logo } from '@angkorgit/design-system';
import { basename } from '@/shared/utils';

const OVERLAY_SHOW_DELAY = 250;
const OVERLAY_MIN_VISIBLE = 450;

function useRepoLoadingOverlay(): boolean {
  const active = useRepo((s) => s.opening !== null || s.refreshing);
  const [visible, setVisible] = useState(false);
  const shownAt = useRef(0);
  useEffect(() => {
    if (active) {
      if (visible) return;
      const timer = window.setTimeout(() => {
        shownAt.current = Date.now();
        setVisible(true);
      }, OVERLAY_SHOW_DELAY);
      return () => window.clearTimeout(timer);
    }
    if (!visible) return;
    const remaining = Math.max(0, OVERLAY_MIN_VISIBLE - (Date.now() - shownAt.current));
    const timer = window.setTimeout(() => setVisible(false), remaining);
    return () => window.clearTimeout(timer);
  }, [active, visible]);
  return visible;
}

function RepoLoadingOverlay() {
  const visible = useRepoLoadingOverlay();
  const opening = useRepo((s) => s.opening);
  const repoName = useRepo((s) => s.repo?.name ?? '');
  if (!visible) return null;
  const name = opening ? basename(opening) : repoName;
  return (
    <div className="animate-fade-in absolute inset-0 z-40 flex flex-col items-center justify-center gap-4 bg-background/95 backdrop-blur-sm">
      <Logo size={64} animated="loop" className="logo-draw-loop text-foreground" />
      {name && (
        <span className="max-w-md truncate text-sm text-muted">Opening {name}…</span>
      )}
    </div>
  );
}

export function RepositoryPage() {
  const repo = useRepo((s) => s.repo);
  const refresh = useRepo((s) => s.refresh);
  const reload = useGraph((s) => s.reload);
  const navigate = useNavigate();
  const toggleTerminal = useUi((s) => s.toggleTerminal);
  const toggleSidebar = useUi((s) => s.toggleSidebar);
  const sidebarOpen = useUi(sidebarVisible);
  const setPaletteOpen = useUi((s) => s.setPaletteOpen);
  const terminalOpen = useUi((s) => s.terminalOpen);
  const conflictFile = useUi((s) => s.conflictFile);
  const centerDiff = useUi((s) => s.centerDiff);
  const centerEditor = useUi((s) => s.centerEditor);
  const centerFileHistory = useUi((s) => s.centerFileHistory);
  const closeCenterDiff = useUi((s) => s.closeCenterDiff);

  const repoPath = repo?.path ?? null;
  useEffect(() => {
    if (!repoPath) {
      navigate('/welcome', { replace: true });
      return;
    }
    useGraph.getState().select(null);
    const ui = useUi.getState();
    ui.closeCenterDiff();
    ui.closeEditor();
    ui.closeFileHistory();
    ui.selectFile(null);
    ui.openConflict(null);
    void reload(repoPath);

    let unlisten: (() => void) | undefined;
    let cancelled = false;
    let refreshing = false;
    let pending = false;
    let refsFingerprint: string | null = null;
    const stillCurrent = () => !cancelled && useRepo.getState().repo?.path === repoPath;
    void ipc
      .refFingerprint(repoPath)
      .then((fingerprint) => {
        if (stillCurrent() && refsFingerprint === null) refsFingerprint = fingerprint;
      })
      .catch(() => undefined);
    const handleChange = async () => {
      if (refreshing) {
        pending = true;
        return;
      }
      refreshing = true;
      try {
        do {
          pending = false;
          if (!stillCurrent()) return;
          const fingerprint = await ipc.refFingerprint(repoPath);
          if (!stillCurrent()) return;
          const refsChanged = refsFingerprint !== fingerprint;
          refsFingerprint = fingerprint;
          if (refsChanged) {
            await useRepo.getState().refresh();
            if (!stillCurrent()) return;
            await useGraph.getState().reload(repoPath);
          } else {
            await useRepo.getState().refreshStatus();
          }
        } while (pending && stillCurrent());
      } finally {
        refreshing = false;
      }
    };
    void ipc.watchRepo(repoPath);
    void listen('repo-changed', () => {
      void handleChange().catch(() => undefined);
    }).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });

    return () => {
      cancelled = true;
      unlisten?.();
      void ipc.watchStop();
    };
  }, [repoPath, reload, navigate]);

  const repoRemotes = useRepo((s) => s.remotes);
  const repoBranches = useRepo((s) => s.branches);
  const forgeKey = useMemo(() => {
    if (repoRemotes.length === 0) return '';
    const upstream = repoBranches.find((b) => !b.isRemote && b.isHead)?.upstream ?? '';
    return `${repoRemotes.map((r) => `${r.name}=${r.url}`).join(',')}|${upstream}`;
  }, [repoRemotes, repoBranches]);
  const showPullRequests = useSettings((s) => s.showPullRequests);
  useEffect(() => {
    if (repoPath && forgeKey && showPullRequests) void useForge.getState().load();
    else useForge.getState().reset();
  }, [repoPath, forgeKey, showPullRequests]);

  const settingsOpen = useUi((s) => s.dialog === 'settings');
  const settingsWasOpen = useRef(false);
  useEffect(() => {
    if (settingsOpen) {
      settingsWasOpen.current = true;
      return;
    }
    if (!settingsWasOpen.current) return;
    settingsWasOpen.current = false;
    if (repoPath && forgeKey && showPullRequests && !useForge.getState().hasAccount) {
      void useForge.getState().load(true);
    }
  }, [settingsOpen, repoPath, forgeKey, showPullRequests]);

  const autoFetchMinutes = useSettings((s) => s.autoFetchMinutes);
  useEffect(() => {
    if (!repoPath || !autoFetchMinutes) return;
    let fetching = false;
    let lastFetch = 0;
    const tick = async () => {
      if (fetching || document.hidden) return;
      if (Date.now() - lastFetch < 30_000) return;
      const state = useRepo.getState();
      if (state.busy || state.repo?.path !== repoPath) return;
      const remote = state.remotes[0]?.name;
      if (!remote) return;
      fetching = true;
      lastFetch = Date.now();
      try {
        await ipc.fetch(repoPath, remote, true, false);
      } catch {
        lastFetch = Date.now() + 4 * 60_000;
      } finally {
        fetching = false;
      }
    };
    const id = window.setInterval(() => void tick(), autoFetchMinutes * 60_000);
    const onFocus = () => void tick();
    window.addEventListener('focus', onFocus);
    void tick();
    return () => {
      window.clearInterval(id);
      window.removeEventListener('focus', onFocus);
    };
  }, [repoPath, autoFetchMinutes]);

  const refreshAll = useCallback(async () => {
    if (!repo) return;
    await refresh();
    await reload(repo.path);
  }, [repo, refresh, reload]);

  const shortcuts = useMemo(
    () => [
      { combo: 'mod+k', handler: () => setPaletteOpen(true) },
      { combo: 'mod+p', handler: () => setPaletteOpen(true) },
      { combo: 'mod+`', handler: () => toggleTerminal() },
      { combo: 'mod+b', handler: () => toggleSidebar() },
      {
        combo: 'mod+z',
        skipInInput: true,
        handler: () => {
          const path = useRepo.getState().repo?.path;
          if (path) void useUndo.getState().undo(path).then((ok) => {
              if (ok) void refreshAll();
            });
        },
      },
      {
        combo: 'mod+shift+z',
        skipInInput: true,
        handler: () => {
          const path = useRepo.getState().repo?.path;
          if (path) void useUndo.getState().redo(path).then((ok) => {
              if (ok) void refreshAll();
            });
        },
      },
      { combo: 'mod+r', handler: () => void refreshAll() },
      { combo: 'mod+enter', handler: () => commitShortcut.current?.() },
      {
        combo: 'mod+,',
        handler: () => useUi.getState().openDialog('settings'),
      },
      {
        combo: 'escape',
        handler: () => {
          const ui = useUi.getState();
          if (ui.conflictFile) ui.openConflict(null);
          else if (ui.centerEditor) editorCloseShortcut.current?.();
          else if (ui.centerDiff) closeCenterDiff();
          else if (ui.centerFileHistory) ui.closeFileHistory();
        },
      },
    ],
    [setPaletteOpen, toggleTerminal, toggleSidebar, refreshAll, closeCenterDiff],
  );
  useShortcuts(shortcuts);

  if (!repo) return null;

  const focusMode = !!centerFileHistory && !centerEditor && !centerDiff;

  return (
    <motion.div
      className="flex h-full flex-col"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.25 }}
    >
      <RepoTabs />
      <Toolbar onRefresh={refreshAll} />
      <div className="relative min-h-0 flex-1">
        <RepoLoadingOverlay />
        <PanelGroup direction="horizontal" autoSaveId="angkorgit-main">
          {sidebarOpen && !focusMode && (
            <>
              <Panel defaultSize={18} minSize={13} maxSize={30} order={1}>
                <Sidebar />
              </Panel>
              <PanelResizeHandle className="w-px bg-border-subtle" />
            </>
          )}
          <Panel defaultSize={54} minSize={30} order={2}>
            <PanelGroup direction="vertical" autoSaveId="angkorgit-center">
              <Panel minSize={30}>
                <div className={centerDiff || centerEditor || centerFileHistory ? 'hidden' : 'h-full'}>
                  <CommitGraph key={repo.path} />
                </div>
                {centerEditor ? (
                  <EditorPanel key={centerEditor} file={centerEditor} />
                ) : centerDiff ? (
                  <DiffPanel target={centerDiff} />
                ) : (
                  centerFileHistory && (
                    <FileHistoryPanel key={centerFileHistory} file={centerFileHistory} />
                  )
                )}
              </Panel>
              {terminalOpen && (
                <>
                  <PanelResizeHandle className="h-px bg-border-subtle" />
                  <Panel defaultSize={30} minSize={12} maxSize={60}>
                    <Suspense fallback={null}>
                      <TerminalPanel />
                    </Suspense>
                  </Panel>
                </>
              )}
            </PanelGroup>
          </Panel>
          {!focusMode && (
            <>
              <PanelResizeHandle className="w-px bg-border-subtle" />
              <Panel defaultSize={28} minSize={20} maxSize={45} order={3}>
                <Inspector />
              </Panel>
            </>
          )}
        </PanelGroup>
      </div>
      <StatusBar />

      <CommandPalette onRefresh={refreshAll} />
      <SettingsDialog />
      <RepoDialogs onDone={refreshAll} />
      <CreatePrDialog />
      <CreateWorktreeDialog />
      <InteractiveRebaseDialog />
      <CloneDialog onCloned={() => void refreshAll()} />
      {conflictFile && (
        <Suspense fallback={null}>
          <ConflictResolver key={conflictFile} file={conflictFile} onResolved={refreshAll} />
        </Suspense>
      )}
    </motion.div>
  );
}
