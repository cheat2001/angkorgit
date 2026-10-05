import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Panel, PanelGroup, PanelResizeHandle, type ImperativePanelHandle } from 'react-resizable-panels';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { useRepo } from './store';
import { fetchRemotes } from './fetchRemotes';
import { useGraph } from '@/features/graph/store';
import { sidebarVisible, useUi } from '@/features/ui/store';
import { RepoTabs } from '@/components/RepoTabs';
import { StatusBar } from '@/components/StatusBar';
import { Toolbar } from '@/components/Toolbar';
import { Sidebar } from '@/features/sidebar/Sidebar';
import { CommitGraph } from '@/features/graph/CommitGraph';
import { InteractiveRebaseDialog } from '@/features/graph/InteractiveRebaseDialog';
import { DiffPanel } from '@/features/diff/DiffPanel';
import { AllChangesView } from '@/features/diff/AllChangesView';
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
import { RepoShortcutDialog } from './RepoShortcutDialog';
import { closeRepoTabs } from './tabs';
import { RepoGroupDialog } from './RepoGroupDialog';
import { useForge } from '@/features/forge/store';
import { seedForgeHostsFromAccounts } from '@/features/forge/hosts';
import { useShortcuts } from '@/shared/useShortcuts';
import { useUndo } from '@/features/history/undoStore';
import { useSettings } from '@/features/settings/store';
import { ipc, listen } from '@/core/ipc';
import { Logo, cn } from '@angkorgit/design-system';
import { basename } from '@/shared/utils';

const OVERLAY_SHOW_DELAY = 250;
const OVERLAY_MIN_VISIBLE = 450;
const SIDEBAR_DEFAULT_SIZE = 18;
const INSPECTOR_DEFAULT_SIZE = 28;
const INSPECTOR_MIN_SIZE = 20;

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
  const diffLayout = useUi((s) => s.diffLayout);
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
    if (repoPath && showPullRequests && (!forgeKey || !useForge.getState().hasAccount)) {
      void seedForgeHostsFromAccounts().then(() => useForge.getState().load(true));
    }
  }, [settingsOpen, repoPath, forgeKey, showPullRequests]);

  const autoFetchMinutes = useSettings((s) => s.autoFetchMinutes);
  const autoFetchRemotes = useRepo((s) => s.remotes.map((remote) => remote.name).join('\n'));
  useEffect(() => {
    if (!repoPath || !autoFetchMinutes || !autoFetchRemotes) return;
    let fetching = false;
    let cancelled = false;
    let lastAttemptAt = 0;
    const tick = async () => {
      if (fetching || cancelled || document.hidden) return;
      const state = useRepo.getState();
      if (state.busy || state.repo?.path !== repoPath) return;
      if (Date.now() - Math.max(lastAttemptAt, state.lastFetchAt ?? 0) < 30_000) return;
      const remoteNames = state.remotes.map((remote) => remote.name);
      if (remoteNames.length === 0) return;
      fetching = true;
      lastAttemptAt = Date.now();
      try {
        const result = await fetchRemotes(remoteNames, (name) => ipc.fetch(repoPath, name, true, false));
        if (!cancelled && useRepo.getState().repo?.path === repoPath) {
          if (result.succeeded.length > 0) useRepo.getState().markFetched();
          useRepo.getState().setFetchFailures(result.failed.map(({ name }) => name));
        }
      } finally {
        fetching = false;
      }
    };
    const id = window.setInterval(() => void tick(), autoFetchMinutes * 60_000);
    const onFocus = () => void tick();
    window.addEventListener('focus', onFocus);
    void tick();
    return () => {
      cancelled = true;
      window.clearInterval(id);
      window.removeEventListener('focus', onFocus);
    };
  }, [repoPath, autoFetchMinutes, autoFetchRemotes]);

  const refreshAll = useCallback(async () => {
    if (!repo) return;
    await refresh();
    await reload(repo.path);
  }, [repo, refresh, reload]);

  const shortcuts = useMemo(
    () => [
      { combo: 'mod+k', handler: () => setPaletteOpen(true) },
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
      {
        combo: 'mod+w',
        handler: (event: KeyboardEvent) => {
          if ((event.target as HTMLElement | null)?.closest('.xterm')) return;
          const path = useRepo.getState().repo?.path;
          if (path) closeRepoTabs([path]);
        },
      },
      { combo: 'mod+enter', handler: () => commitShortcut.current?.() },
      {
        combo: 'mod+,',
        handler: () => useUi.getState().openDialog('settings'),
      },
      {
        combo: 'escape',
        handler: () => {
          const ui = useUi.getState();
          if (ui.conflictFile) return;
          if (ui.centerEditor) editorCloseShortcut.current?.();
          else if (ui.centerDiff) closeCenterDiff();
          else if (ui.centerFileHistory) ui.closeFileHistory();
        },
      },
    ],
    [setPaletteOpen, toggleTerminal, toggleSidebar, refreshAll, closeCenterDiff],
  );
  useShortcuts(shortcuts);

  const focusMode = !!centerFileHistory && !centerEditor && !centerDiff;
  const showSidebar = sidebarOpen && !focusMode;
  const focusModeRef = useRef(focusMode);
  focusModeRef.current = focusMode;
  const showSidebarRef = useRef(showSidebar);
  showSidebarRef.current = showSidebar;
  const sidebarDragging = useRef(false);
  const sidebarPanel = useRef<ImperativePanelHandle>(null);
  const inspectorPanel = useRef<ImperativePanelHandle>(null);
  const inspectorSizeBeforeFocus = useRef<number | null>(null);
  useEffect(() => {
    const panel = sidebarPanel.current;
    if (!panel) return;
    if (showSidebar) {
      if (panel.isCollapsed()) panel.expand(SIDEBAR_DEFAULT_SIZE);
    } else if (!panel.isCollapsed()) {
      panel.collapse();
    }
  }, [showSidebar, repo]);
  useLayoutEffect(() => {
    const panel = inspectorPanel.current;
    if (!panel) return;
    if (focusMode) {
      if (!panel.isCollapsed()) {
        inspectorSizeBeforeFocus.current = panel.getSize();
        panel.collapse();
      }
    } else {
      const restore = inspectorSizeBeforeFocus.current;
      inspectorSizeBeforeFocus.current = null;
      if (restore != null && restore >= INSPECTOR_MIN_SIZE) panel.resize(restore);
    }
  }, [focusMode, repo]);

  if (!repo) return null;

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
        <PanelGroup direction="horizontal" autoSaveId="angkorgit-main-v2">
          <Panel
            ref={sidebarPanel}
            id="sidebar"
            order={1}
            defaultSize={SIDEBAR_DEFAULT_SIZE}
            minSize={13}
            maxSize={30}
            collapsible
            collapsedSize={0}
            onCollapse={() => {
              if (sidebarDragging.current) {
                const ui = useUi.getState();
                if (ui.sidebarOpen && !ui.sidebarHiddenForDiff && !focusModeRef.current) ui.setSidebarOpen(false);
                return;
              }
              if (showSidebarRef.current) {
                requestAnimationFrame(() => {
                  const panel = sidebarPanel.current;
                  if (panel && showSidebarRef.current && panel.isCollapsed()) panel.expand(SIDEBAR_DEFAULT_SIZE);
                });
              }
            }}
            onExpand={() => {
              if (!sidebarDragging.current) return;
              const ui = useUi.getState();
              if (!ui.sidebarOpen && !ui.sidebarHiddenForDiff && !focusModeRef.current) ui.setSidebarOpen(true);
            }}
          >
            {showSidebar && <Sidebar />}
          </Panel>
          <PanelResizeHandle
            className={cn('w-px bg-border-subtle', !showSidebar && 'hidden')}
            onDragging={(dragging) => {
              sidebarDragging.current = dragging;
            }}
          />
          <Panel id="center" order={2} defaultSize={54} minSize={30}>
            <PanelGroup direction="vertical" autoSaveId="angkorgit-center">
              <Panel minSize={30}>
                <div className={centerDiff || centerEditor || centerFileHistory ? 'hidden' : 'h-full'}>
                  <CommitGraph key={repo.path} />
                </div>
                {centerEditor ? (
                  <EditorPanel key={centerEditor} file={centerEditor} />
                ) : centerDiff ? (
                  diffLayout === 'all' && centerDiff.oid && !centerDiff.unchanged ? (
                    <AllChangesView key={centerDiff.oid} target={{ ...centerDiff, oid: centerDiff.oid }} />
                  ) : (
                    <DiffPanel target={centerDiff} />
                  )
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
          <PanelResizeHandle className={cn('w-px bg-border-subtle', focusMode && 'hidden')} />
          <Panel
            ref={inspectorPanel}
            id="inspector"
            order={3}
            defaultSize={INSPECTOR_DEFAULT_SIZE}
            minSize={INSPECTOR_MIN_SIZE}
            maxSize={45}
            collapsible={focusMode}
            collapsedSize={0}
          >
            {!focusMode && <Inspector />}
          </Panel>
        </PanelGroup>
      </div>
      <StatusBar />

      <CommandPalette onRefresh={refreshAll} />
      <SettingsDialog />
      <RepoDialogs onDone={refreshAll} />
      <CreatePrDialog />
      <CreateWorktreeDialog />
      <RepoShortcutDialog />
      <RepoGroupDialog />
      <InteractiveRebaseDialog />
      <CloneDialog
        onCloned={(path) =>
          void useRepo
            .getState()
            .open(path)
            .catch((error) =>
              toast.error(
                `Could not open repository: ${(error as { message?: string }).message ?? error}`,
              ),
            )
        }
      />
      {conflictFile && (
        <Suspense fallback={null}>
          <ConflictResolver key={conflictFile} file={conflictFile} onResolved={refreshAll} />
        </Suspense>
      )}
    </motion.div>
  );
}
