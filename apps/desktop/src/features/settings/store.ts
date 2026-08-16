import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  AI_PROVIDER_PRESETS,
  DEFAULT_AI_STYLE,
  type AiConfig,
  type AiProviderKind,
  type AiStyleConfig,
  type CommitStyle,
} from '@angkorgit/core';
import { ipc, isTauri } from '@/core/ipc';

export type Theme =
  | 'dark'
  | 'light'
  | 'angkor-dusk'
  | 'angkor-dawn'
  | 'vscode-dark'
  | 'vscode-light'
  | 'github-dark'
  | 'github-light'
  | 'one-dark-pro'
  | 'tokyo-night'
  | 'catppuccin-mocha'
  | 'catppuccin-latte'
  | 'dracula'
  | 'nord'
  | 'ayu-dark'
  | 'ayu-light';

export interface ThemeMeta {
  id: Theme;
  label: string;
  base: 'dark' | 'light';
  swatch: { bg: string; fg: string; dots: [string, string, string] };
}

export const THEMES: ThemeMeta[] = [
  { id: 'dark', label: 'AngKor Dark', base: 'dark', swatch: { bg: '#0d1220', fg: '#e5e9f0', dots: ['#d97706', '#22c55e', '#38bdf8'] } },
  { id: 'light', label: 'AngKor Light', base: 'light', swatch: { bg: '#f5f7fa', fg: '#1b2437', dots: ['#d97706', '#15803d', '#0369a1'] } },
  { id: 'angkor-dusk', label: 'Angkor Dusk', base: 'dark', swatch: { bg: '#1e150d', fg: '#eae1d1', dots: ['#e08c16', '#22c55e', '#38bdf8'] } },
  { id: 'angkor-dawn', label: 'Angkor Dawn', base: 'light', swatch: { bg: '#f3edde', fg: '#31251a', dots: ['#b45f06', '#15803d', '#0369a1'] } },
  { id: 'vscode-dark', label: 'VS Code Dark+', base: 'dark', swatch: { bg: '#1e1e1e', fg: '#d4d4d4', dots: ['#569cd6', '#ce9178', '#dcdcaa'] } },
  { id: 'vscode-light', label: 'VS Code Light+', base: 'light', swatch: { bg: '#ffffff', fg: '#333333', dots: ['#0000ff', '#a31515', '#795e26'] } },
  { id: 'github-dark', label: 'GitHub Dark', base: 'dark', swatch: { bg: '#0d1117', fg: '#c9d1d9', dots: ['#ff7b72', '#a5d6ff', '#d2a8ff'] } },
  { id: 'github-light', label: 'GitHub Light', base: 'light', swatch: { bg: '#ffffff', fg: '#24292f', dots: ['#cf222e', '#0a3069', '#8250df'] } },
  { id: 'one-dark-pro', label: 'One Dark Pro', base: 'dark', swatch: { bg: '#282c34', fg: '#abb2bf', dots: ['#c678dd', '#98c379', '#61afef'] } },
  { id: 'tokyo-night', label: 'Tokyo Night', base: 'dark', swatch: { bg: '#1a1b26', fg: '#c0caf5', dots: ['#bb9af7', '#9ece6a', '#7aa2f7'] } },
  { id: 'catppuccin-mocha', label: 'Catppuccin Mocha', base: 'dark', swatch: { bg: '#1e1e2e', fg: '#cdd6f4', dots: ['#cba6f7', '#a6e3a1', '#89b4fa'] } },
  { id: 'catppuccin-latte', label: 'Catppuccin Latte', base: 'light', swatch: { bg: '#eff1f5', fg: '#4c4f69', dots: ['#8839ef', '#40a02b', '#1e66f5'] } },
  { id: 'dracula', label: 'Dracula', base: 'dark', swatch: { bg: '#282a36', fg: '#f8f8f2', dots: ['#ff79c6', '#f1fa8c', '#50fa7b'] } },
  { id: 'nord', label: 'Nord', base: 'dark', swatch: { bg: '#2e3440', fg: '#d8dee9', dots: ['#81a1c1', '#a3be8c', '#88c0d0'] } },
  { id: 'ayu-dark', label: 'Ayu Dark', base: 'dark', swatch: { bg: '#0a0e14', fg: '#b3b1ad', dots: ['#ff8f40', '#c2d94c', '#ffb454'] } },
  { id: 'ayu-light', label: 'Ayu Light', base: 'light', swatch: { bg: '#fafafa', fg: '#5c6773', dots: ['#fa8d3e', '#86b300', '#399ee6'] } },
];

export const themeBase = (id: Theme): 'dark' | 'light' =>
  THEMES.find((t) => t.id === id)?.base ?? 'dark';

export function applyTheme(theme: Theme): void {
  const el = document.documentElement;
  const base = themeBase(theme);
  el.classList.toggle('dark', base === 'dark');
  el.classList.toggle('light', base === 'light');
  for (const cls of Array.from(el.classList)) {
    if (cls.startsWith('theme-')) el.classList.remove(cls);
  }
  if (theme !== 'dark' && theme !== 'light') el.classList.add(`theme-${theme}`);
}

export type AccentId = 'gold' | 'jade' | 'sapphire' | 'lotus' | 'crimson';

export const ACCENTS: Array<{ id: AccentId; label: string; color: string }> = [
  { id: 'gold', label: 'Temple Gold', color: '#D97706' },
  { id: 'jade', label: 'Jade', color: '#10B981' },
  { id: 'sapphire', label: 'Sapphire', color: '#3B82F6' },
  { id: 'lotus', label: 'Lotus', color: '#EC4899' },
  { id: 'crimson', label: 'Crimson', color: '#EF4444' },
];

const ACCENT_CLASSES = ACCENTS.filter((a) => a.id !== 'gold').map((a) => `accent-${a.id}`);

export function applyReduceMotion(reduceMotion: boolean): void {
  const el = document.documentElement;
  el.classList.toggle('reduce-motion', reduceMotion);
}

function applyAccent(accent: AccentId): void {
  const el = document.documentElement;
  el.classList.remove(...ACCENT_CLASSES);
  if (accent !== 'gold') el.classList.add(`accent-${accent}`);
}

export interface IdentityProfile {
  id: string;
  label: string;
  name: string;
  email: string;
  accounts?: Record<string, string>;
}

export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 2;
export const ZOOM_STEP = 0.1;

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

export type AiProfile = Omit<AiConfig, 'provider'>;

function splitProvider(config: AiConfig): { provider: AiProviderKind; profile: AiProfile } {
  const { provider, ...profile } = config;
  return { provider, profile };
}

function defaultProfile(provider: AiProviderKind): AiProfile {
  return { apiKey: '', model: AI_PROVIDER_PRESETS[provider].defaultModel, baseUrl: '' };
}

interface SettingsState {
  theme: Theme;
  accent: AccentId;
  zoom: number;
  sshKeyPath: string;
  sshUseAgent: boolean;
  useCredentialHelper: boolean;
  reduceMotion: boolean;
  autoFetchMinutes: number;
  profiles: IdentityProfile[];
  ai: AiConfig;
  aiProfiles: Partial<Record<AiProviderKind, AiProfile>>;
  aiStyle: AiStyleConfig;
  setTheme: (theme: Theme) => void;
  setAccent: (accent: AccentId) => void;
  setZoom: (zoom: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomReset: () => void;
  setSshKeyPath: (path: string) => void;
  setSshUseAgent: (value: boolean) => void;
  setUseCredentialHelper: (value: boolean) => void;
  setReduceMotion: (value: boolean) => void;
  setAutoFetchMinutes: (minutes: number) => void;
  addProfile: (profile: Omit<IdentityProfile, 'id'>) => void;
  updateProfile: (id: string, patch: Partial<Omit<IdentityProfile, 'id'>>) => void;
  removeProfile: (id: string) => void;
  setAi: (config: Partial<AiConfig>) => void;
  setAiProvider: (provider: AiProviderKind) => void;
  setCommitStyle: (style: Partial<CommitStyle>) => void;
}

const clampZoom = (zoom: number): number =>
  Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(zoom * 100) / 100));

async function loadAiKey(provider: AiProviderKind): Promise<void> {
  const key = await ipc.aiKeyGet(provider);
  if (!key) return;
  const s = useSettings.getState();
  const profile = s.aiProfiles[provider];
  if (profile?.apiKey) return;
  const aiProfiles = {
    ...s.aiProfiles,
    [provider]: { ...(profile ?? defaultProfile(provider)), apiKey: key },
  };
  if (s.ai.provider === provider && !s.ai.apiKey) {
    useSettings.setState({ ai: { ...s.ai, apiKey: key }, aiProfiles });
  } else {
    useSettings.setState({ aiProfiles });
  }
}

function stripApiKeys(
  profiles: Partial<Record<AiProviderKind, AiProfile>>,
): Partial<Record<AiProviderKind, AiProfile>> {
  return Object.fromEntries(
    Object.entries(profiles).map(([provider, profile]) => [
      provider,
      { ...profile, apiKey: '' },
    ]),
  ) as Partial<Record<AiProviderKind, AiProfile>>;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set, get) => ({
      theme: 'angkor-dusk',
      accent: 'gold',
      zoom: 1,
      sshKeyPath: '',
      sshUseAgent: true,
      useCredentialHelper: true,
      autoFetchMinutes: 1,
      reduceMotion:
        typeof window !== 'undefined' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      profiles: [],
      ai: { provider: 'ollama', apiKey: '', model: 'llama3.1', baseUrl: '' },
      aiProfiles: {},
      aiStyle: DEFAULT_AI_STYLE,
      setTheme: (theme) => {
        applyTheme(theme);
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
      setSshKeyPath: (sshKeyPath) => set({ sshKeyPath }),
      setSshUseAgent: (sshUseAgent) => set({ sshUseAgent }),
      setUseCredentialHelper: (useCredentialHelper) => set({ useCredentialHelper }),
      setAutoFetchMinutes: (autoFetchMinutes) => set({ autoFetchMinutes }),
      setReduceMotion: (reduceMotion) => {
        applyReduceMotion(reduceMotion);
        set({ reduceMotion });
      },
      addProfile: (profile) =>
        set((s) => ({
          profiles: [...s.profiles, { ...profile, id: crypto.randomUUID() }],
        })),
      updateProfile: (id, patch) =>
        set((s) => ({
          profiles: s.profiles.map((p) => (p.id === id ? { ...p, ...patch } : p)),
        })),
      removeProfile: (id) => set((s) => ({ profiles: s.profiles.filter((p) => p.id !== id) })),
      setAi: (config) => {
        const s = get();
        const ai = { ...s.ai, ...config };
        const { provider, profile } = splitProvider(ai);
        if (config.apiKey !== undefined && config.apiKey !== s.ai.apiKey) {
          void ipc.aiKeySet(provider, config.apiKey);
        }
        set({ ai, aiProfiles: { ...s.aiProfiles, [provider]: profile } });
      },
      setAiProvider: (provider) => {
        const s = get();
        if (provider === s.ai.provider) return;
        const current = splitProvider(s.ai);
        const next = s.aiProfiles[provider] ?? defaultProfile(provider);
        set({
          ai: { provider, ...next },
          aiProfiles: {
            ...s.aiProfiles,
            [current.provider]: current.profile,
            [provider]: next,
          },
        });
        if (!next.apiKey) void loadAiKey(provider);
      },
      setCommitStyle: (style) =>
        set((s) => ({ aiStyle: { ...s.aiStyle, commit: { ...s.aiStyle.commit, ...style } } })),
    }),
    {
      name: 'angkorgit-settings',
      partialize: (state) => ({
        ...state,
        ai: { ...state.ai, apiKey: '' },
        aiProfiles: stripApiKeys(state.aiProfiles),
      }),
      merge: (persisted, current) => {
        const stored = (persisted ?? {}) as Partial<SettingsState>;
        return {
          ...current,
          ...stored,
          ai: { ...current.ai, ...(stored.ai ?? {}) },
          aiStyle: {
            ...current.aiStyle,
            ...(stored.aiStyle ?? {}),
            commit: { ...current.aiStyle.commit, ...(stored.aiStyle?.commit ?? {}) },
          },
        };
      },
      onRehydrateStorage: () => (state) => {
        applyTheme(state?.theme ?? 'angkor-dusk');
        const zoom = state?.zoom ?? 1;
        if (zoom !== 1) applyZoom(zoom);
        applyAccent(state?.accent ?? 'gold');
        applyReduceMotion(state?.reduceMotion ?? false);
        if (state && Object.keys(state.aiProfiles ?? {}).length === 0) {
          const { provider, profile } = splitProvider(state.ai);
          state.aiProfiles = { [provider]: profile };
        }
        if (!state) return;
        const plaintext: Array<[AiProviderKind, string]> = [];
        for (const [provider, profile] of Object.entries(state.aiProfiles ?? {})) {
          if (profile?.apiKey) plaintext.push([provider as AiProviderKind, profile.apiKey]);
        }
        if (state.ai.apiKey && !plaintext.some(([provider]) => provider === state.ai.provider)) {
          plaintext.push([state.ai.provider, state.ai.apiKey]);
        }
        for (const [provider, key] of plaintext) void ipc.aiKeySet(provider, key);
        const active = state.ai.provider;
        queueMicrotask(() => {
          if (plaintext.length > 0) useSettings.setState((s) => ({ zoom: s.zoom }));
          if (!useSettings.getState().ai.apiKey) void loadAiKey(active);
        });
      },
    },
  ),
);
