import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AiConfig } from '@angkorgit/core';
import { isTauri } from '@/core/ipc';

export type Theme = 'dark' | 'light';

/** User-selectable primary accent. Temple Gold is the brand default. */
export type AccentId = 'gold' | 'jade' | 'sapphire' | 'lotus' | 'crimson';

export const ACCENTS: Array<{ id: AccentId; label: string; color: string }> = [
  { id: 'gold', label: 'Temple Gold', color: '#D97706' },
  { id: 'jade', label: 'Jade', color: '#10B981' },
  { id: 'sapphire', label: 'Sapphire', color: '#3B82F6' },
  { id: 'lotus', label: 'Lotus', color: '#EC4899' },
  { id: 'crimson', label: 'Crimson', color: '#EF4444' },
];

const ACCENT_CLASSES = ACCENTS.filter((a) => a.id !== 'gold').map((a) => `accent-${a.id}`);

function applyAccent(accent: AccentId): void {
  const el = document.documentElement;
  el.classList.remove(...ACCENT_CLASSES);
  if (accent !== 'gold') el.classList.add(`accent-${accent}`);
}

/** A reusable committer identity (e.g. Work vs Personal). */
export interface IdentityProfile {
  id: string;
  label: string;
  name: string;
  email: string;
}

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
  accent: AccentId;
  /** UI zoom factor, 0.6–1.6 (1 = 100%). */
  zoom: number;
  /** Path to a git executable for the built-in terminal PATH hint. */
  gitExecutable: string;
  sshKeyPath: string;
  /** Reduced motion switch for all Framer Motion animation. */
  reduceMotion: boolean;
  /** GitHub login connected via token (display only — token lives in keychain). */
  githubUser: string;
  /** Committer identity profiles for quick per-repo switching. */
  profiles: IdentityProfile[];
  ai: AiConfig;
  setTheme: (theme: Theme) => void;
  setAccent: (accent: AccentId) => void;
  setZoom: (zoom: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomReset: () => void;
  setGitExecutable: (path: string) => void;
  setSshKeyPath: (path: string) => void;
  setReduceMotion: (value: boolean) => void;
  setGithubUser: (login: string) => void;
  addProfile: (profile: Omit<IdentityProfile, 'id'>) => void;
  removeProfile: (id: string) => void;
  setAi: (config: Partial<AiConfig>) => void;
}

const clampZoom = (zoom: number): number =>
  Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(zoom * 10) / 10));

export const useSettings = create<SettingsState>()(
  persist(
    (set, get) => ({
      theme: 'dark',
      accent: 'gold',
      zoom: 1,
      gitExecutable: 'git',
      sshKeyPath: '',
      reduceMotion: false,
      githubUser: '',
      profiles: [],
      ai: { provider: 'ollama', apiKey: '', model: 'llama3.1', baseUrl: '' },
      setTheme: (theme) => {
        document.documentElement.classList.toggle('dark', theme === 'dark');
        document.documentElement.classList.toggle('light', theme === 'light');
        set({ theme });
      },
      setAccent: (accent) => {
        applyAccent(accent);
        set({ accent });
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
      setGithubUser: (githubUser) => set({ githubUser }),
      addProfile: (profile) =>
        set((s) => ({
          profiles: [...s.profiles, { ...profile, id: crypto.randomUUID() }],
        })),
      removeProfile: (id) => set((s) => ({ profiles: s.profiles.filter((p) => p.id !== id) })),
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
        applyAccent(state?.accent ?? 'gold');
      },
    },
  ),
);
