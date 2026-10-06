import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { orderRepoTabs, repoForChord } from '@angkorgit/core';
import { useRepo } from './store';
import { useSettings } from '@/features/settings/store';
import { useUi } from '@/features/ui/store';
import { basename, isMac } from '@/shared/utils';

const TAB_DIGIT = /^Digit([1-9])$/;

export async function switchToRepo(path: string, ensureRepoRoute: () => void): Promise<void> {
  const { repo, opening, open } = useRepo.getState();
  if (opening !== null || repo?.path === path) return;
  useUi.getState().setPaletteOpen(false);
  try {
    await open(path);
    ensureRepoRoute();
  } catch (error) {
    toast.error(`Could not open ${basename(path)}: ${(error as { message?: string }).message ?? error}`);
  }
}

function tabForKey(event: KeyboardEvent, tabs: string[], activePath: string | null): string | null {
  const mod = isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  if (!mod || event.altKey) return null;
  const digit = TAB_DIGIT.exec(event.code);
  if (digit && !event.shiftKey) return tabs[Number(digit[1]) - 1] ?? null;
  if (!event.shiftKey || tabs.length < 2) return null;
  if (event.code !== 'BracketLeft' && event.code !== 'BracketRight') return null;
  const current = activePath ? tabs.indexOf(activePath) : -1;
  const step = event.code === 'BracketRight' ? 1 : -1;
  return tabs[(current + step + tabs.length) % tabs.length] ?? null;
}

export function useRepoShortcuts(): void {
  const navigate = useNavigate();
  const location = useLocation();
  const pathname = useRef(location.pathname);
  pathname.current = location.pathname;

  useEffect(() => {
    const ensureRepoRoute = () => {
      if (pathname.current !== '/repo') navigate('/repo');
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('.xterm')) return;
      const ui = useUi.getState();
      if (ui.dialog || ui.conflictFile) return;
      const activePath = useRepo.getState().repo?.path ?? null;
      const settings = useSettings.getState();
      const ordered = orderRepoTabs(ui.repoTabs, settings.repoGroups, settings.repoGroupOf, ui.worktreeMains);
      const path = tabForKey(event, ordered, activePath) ?? repoForChord(settings.repoShortcuts, event);
      if (!path) return;
      event.preventDefault();
      void switchToRepo(path, ensureRepoRoute);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [navigate]);
}
