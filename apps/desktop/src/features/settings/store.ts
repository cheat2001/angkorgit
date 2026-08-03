import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AiConfig } from '@angkorgit/core';
import { isTauri } from '@/core/ipc';

export type Theme = 'dark' | 'light';

export const ZOOM_MIN = 0.6;
export const ZOOM_MAX = 1.6;
export const ZOOM_STEP = 0.1;

/** Native webview zoom in Tauri (crisp, browser-like); CSS zoom elsewhere. */
function applyZoom(zoom: number): void {
  if (isTauri()) {
    void import('@tauri-apps/api/webview').then(({ getCurrentWebview }) =>
      getCurrentWebview()
        .setZoom(zoom)
        .catch(() => {
          (document.documentElement.style as CSSStyleDeclaration & { zoom: string }).zoom = String(zoom);
        }),
    );
  } else {
    (document.documentElement.style as CSSStyleDeclaration & { zoom: string }).zoom = String(zoom);
  }
}

interface SettingsState {
  theme: Theme;
  /** UI zoom factor, 0.6–1.6 (1 = 100%). */
  zoom: number;
  /** Path to a git executable for the built-in terminal PATH hint. */
  gitExecutable: string;
  sshKeyPath: string;
  /** Reduced motion switch for all Framer Motion animation. */
  reduceMotion: boolean;
  ai: AiConfig;
  setTheme: (theme: Theme) => void;
  setZoom: (zoom: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomReset: () => void;
  setGitExecutable: (path: string) => void;
  setSshKeyPath: (path: string) => void;
  setReduceMotion: (value: boolean) => void;
  setAi: (config: Partial<AiConfig>) => void;
}

const clampZoom = (zoom: number): number =>
  Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(zoom * 10) / 10));

export const useSettings = create<SettingsState>()(
  persist(
    (set, get) => ({
      theme: 'dark',
      zoom: 1,
      gitExecutable: 'git',
      sshKeyPath: '',
      reduceMotion: false,
      ai: { provider: 'ollama', apiKey: '', model: 'llama3.1', baseUrl: '' },
      setTheme: (theme) => {
        document.documentElement.classList.toggle('dark', theme === 'dark');
        document.documentElement.classList.toggle('light', theme === 'light');
        set({ theme });
      },
      setZoom: (zoom) => {
        const clamped = clampZoom(zoom);
        applyZoom(clamped);
        set({ zoom: clamped });
      },
      zoomIn: () => get().setZoom(get().zoom + ZOOM_STEP),
      zoomOut: () => get().setZoom(get().zoom - ZOOM_STEP),
      zoomReset: () => get().setZoom(1),
      setGitExecutable: (gitExecutable) => set({ gitExecutable }),
      setSshKeyPath: (sshKeyPath) => set({ sshKeyPath }),
      setReduceMotion: (reduceMotion) => set({ reduceMotion }),
      setAi: (config) => set((s) => ({ ai: { ...s.ai, ...config } })),
    }),
    {
      name: 'angkorgit-settings',
      onRehydrateStorage: () => (state) => {
        const theme = state?.theme ?? 'dark';
        document.documentElement.classList.toggle('dark', theme === 'dark');
        document.documentElement.classList.toggle('light', theme === 'light');
        const zoom = state?.zoom ?? 1;
        if (zoom !== 1) applyZoom(zoom);
      },
    },
  ),
);
