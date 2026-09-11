import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { AnimatePresence, MotionConfig } from 'framer-motion';
import { Toaster, toast } from 'sonner';
import { Spinner, TooltipProvider } from '@angkorgit/design-system';
import { SplashScreen } from './SplashScreen';
import { ConfirmHost } from '@/components/confirm';
import { ProfilePromptHost } from '@/components/profilePrompt';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { WelcomePage } from '@/features/repository/WelcomePage';

const RepositoryPage = lazy(() =>
  import('@/features/repository/RepositoryPage').then((m) => ({ default: m.RepositoryPage })),
);
import { useRepo } from '@/features/repository/store';
import { applyTheme, themeBase, useSettings } from '@/features/settings/store';
import { useUi, type ClonePreset } from '@/features/ui/store';
import { useShortcuts } from '@/shared/useShortcuts';
import { ipc, listen, type CliRequest } from '@/core/ipc';

function Shell() {
  const [splash, setSplash] = useState(true);
  const loadRecents = useRepo((s) => s.loadRecents);
  const navigate = useNavigate();

  const zoomShortcuts = useMemo(
    () => [
      { combo: 'mod+=', handler: () => useSettings.getState().zoomIn(), allowInInput: true },
      { combo: 'mod+shift+=', handler: () => useSettings.getState().zoomIn(), allowInInput: true },
      { combo: 'mod+-', handler: () => useSettings.getState().zoomOut(), allowInInput: true },
      { combo: 'mod+0', handler: () => useSettings.getState().zoomReset(), allowInInput: true },
    ],
    [],
  );
  useShortcuts(zoomShortcuts);

  useEffect(() => {
    const splashStart = Date.now();
    const splashFloor = useSettings.getState().reduceMotion ? 0 : 600;
    let finished = false;
    let readyTimer: number | undefined;
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    let pendingClone: ClonePreset | null = null;
    const openClone = (preset: ClonePreset) => {
      useUi.getState().openDialog('clone', preset);
      navigate('/welcome', { replace: true });
    };
    const finishSplash = () => {
      if (finished) return;
      finished = true;
      setSplash(false);
      if (pendingClone) openClone(pendingClone);
      else navigate(useRepo.getState().repo ? '/repo' : '/welcome', { replace: true });
    };
    const openFromCli = (path: string) => {
      const { repo, opening } = useRepo.getState();
      if (opening === path || repo?.path === path) {
        if (finished) navigate('/repo');
        return Promise.resolve();
      }
      return useRepo
        .getState()
        .open(path)
        .then(() => {
          if (finished) navigate('/repo');
          else finishSplash();
        })
        .catch((error) => {
          toast.error(
            `Could not open repository: ${(error as { message?: string }).message ?? error}`,
          );
          if (!finished) finishSplash();
        });
    };
    const runCli = (request: CliRequest) => {
      if (request.kind === 'open') return openFromCli(request.path);
      const preset: ClonePreset = {
        url: request.url,
        into: request.into,
        branch: request.branch,
      };
      if (finished) openClone(preset);
      else pendingClone = preset;
      return Promise.resolve();
    };
    const splashFallback = window.setTimeout(() => {
      if (!useRepo.getState().opening) finishSplash();
    }, 1600);
    void loadRecents()
      .catch(() => undefined)
      .then(() => ipc.cliPendingOpen())
      .then((request) => (request ? runCli(request) : undefined))
      .catch(() => undefined)
      .finally(() => {
        if (useRepo.getState().opening) return;
        readyTimer = window.setTimeout(
          finishSplash,
          Math.max(0, splashFloor - (Date.now() - splashStart)),
        );
      });
    void listen('cli-request', (payload) => {
      const request = payload as CliRequest | null;
      if (request?.kind === 'open' || request?.kind === 'clone') void runCli(request);
    }).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });
    const updateTimer = setTimeout(() => {
      void import('@/features/updater/check').then(({ checkForUpdates }) =>
        checkForUpdates({ silent: true }),
      );
    }, 5000);
    return () => {
      cancelled = true;
      unlisten?.();
      clearTimeout(splashFallback);
      if (readyTimer !== undefined) clearTimeout(readyTimer);
      clearTimeout(updateTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      {!splash && (
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center bg-background">
              <Spinner className="size-5" />
            </div>
          }
        >
          <Routes>
            <Route path="/welcome" element={<WelcomePage />} />
            <Route path="/repo" element={<RepositoryPage />} />
            <Route path="*" element={<WelcomePage />} />
          </Routes>
        </Suspense>
      )}
      <AnimatePresence>{splash && <SplashScreen key="splash" />}</AnimatePresence>
    </>
  );
}

export function App() {
  const theme = useSettings((s) => s.theme);
  const reduceMotion = useSettings((s) => s.reduceMotion);
  const sshKeyPath = useSettings((s) => s.sshKeyPath);
  const sshUseAgent = useSettings((s) => s.sshUseAgent);
  const useCredentialHelper = useSettings((s) => s.useCredentialHelper);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    void ipc.setCredentialPrefs(sshKeyPath.trim() || null, sshUseAgent, useCredentialHelper);
  }, [sshKeyPath, sshUseAgent, useCredentialHelper]);

  useEffect(() => {
    const onContextMenu = (e: MouseEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      e.preventDefault();
    };
    document.addEventListener('contextmenu', onContextMenu);
    return () => document.removeEventListener('contextmenu', onContextMenu);
  }, []);

  return (
    <MotionConfig reducedMotion={reduceMotion ? 'always' : 'never'}>
      <TooltipProvider>
      <MemoryRouter initialEntries={['/']}>
        <div className="h-full">
          <ErrorBoundary>
            <Shell />
          </ErrorBoundary>
        </div>
      </MemoryRouter>
      <ConfirmHost />
      <ProfilePromptHost />
      <Toaster
        position="bottom-left"
        theme={themeBase(theme)}
        closeButton
        gap={8}
        toastOptions={{
          style: {
            background: 'hsl(var(--surface-overlay))',
            border: '1px solid hsl(var(--border))',
            color: 'hsl(var(--foreground))',
            boxShadow: 'var(--shadow-soft)',
            borderRadius: 'var(--radius)',
          },
          classNames: {
            success: '!border-l-[3px] !border-l-success',
            error: '!border-l-[3px] !border-l-danger',
            warning: '!border-l-[3px] !border-l-primary',
            info: '!border-l-[3px] !border-l-info',
          },
        }}
      />
      </TooltipProvider>
    </MotionConfig>
  );
}
