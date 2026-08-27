import { useCallback, useEffect, useMemo } from 'react';
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
import { EditorPanel } from '@/features/editor/EditorPanel';
import { FileHistoryPanel } from '@/features/history/FileHistoryPanel';
import { Inspector } from '@/features/inspector/Inspector';
import { TerminalPanel } from '@/features/terminal/TerminalPanel';
import { CommandPalette } from '@/components/CommandPalette';
import { ConflictResolver } from '@/features/conflicts/ConflictResolver';
import { SettingsDialog } from '@/features/settings/SettingsDialog';
import { RepoDialogs } from './RepoDialogs';
import { CloneDialog } from './CloneDialog';
import { CreatePrDialog } from '@/features/forge/CreatePrDialog';
import { useForge } from '@/features/forge/store';
import { useShortcuts } from '@/shared/useShortcuts';
import { useUndo } from '@/features/history/undoStore';
import { useSettings } from '@/features/settings/store';
import { ipc, listen } from '@/core/ipc';

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
    const stillCurrent = () => !cancelled && useRepo.getState().repo?.path === repoPath;
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
          const info = await ipc.repoInfo(repoPath);
          if (!stillCurrent()) return;
          const current = useRepo.getState().repo;
          const headChanged =
            info.headOid !== current?.headOid || info.headBranch !== current?.headBranch;
          let refsChanged = false;
          if (!headChanged) {
            const branches = await ipc.branches(repoPath);
            if (!stillCurrent()) return;
            const fingerprint = (list: { name: string; targetOid: string }[]) =>
              list.map((b) => `${b.name}:${b.targetOid}`).join('|');
            refsChanged = fingerprint(branches) !== fingerprint(useRepo.getState().branches);
          }
          if (headChanged || refsChanged) {
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
      void handleChange();
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

  const forgeKey = useRepo((s) => {
    if (s.remotes.length === 0) return '';
    const upstream = s.branches.find((b) => !b.isRemote && b.isHead)?.upstream ?? '';
    return `${s.remotes.map((r) => `${r.name}=${r.url}`).join(',')}|${upstream}`;
  });
  const showPullRequests = useSettings((s) => s.showPullRequests);
  useEffect(() => {
    if (repoPath && forgeKey && showPullRequests) void useForge.getState().load();
    else useForge.getState().reset();
  }, [repoPath, forgeKey, showPullRequests]);

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
      {
        combo: 'mod+,',
        handler: () => useUi.getState().openDialog('settings'),
      },
      {
        combo: 'escape',
        handler: () => {
          const ui = useUi.getState();
          if (ui.centerDiff) closeCenterDiff();
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
      <div className="min-h-0 flex-1">
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
                    <TerminalPanel />
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
      <InteractiveRebaseDialog />
      <CloneDialog onCloned={() => void refreshAll()} />
      {conflictFile && <ConflictResolver key={conflictFile} file={conflictFile} onResolved={refreshAll} />}
    </motion.div>
  );
}
