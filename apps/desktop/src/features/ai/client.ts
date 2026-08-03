import { createAiProvider, type AiProvider } from '@angkorgit/core';
import { ipc } from '@/core/ipc';
import { useSettings } from '@/features/settings/store';

/**
 * Bridges the provider-agnostic AI module to the app: reads the configured
 * provider from settings and injects the Rust-backed HTTP transport.
 */
export function getAiProvider(): AiProvider {
  const { ai } = useSettings.getState();
  return createAiProvider(
    {
      ...ai,
      baseUrl: ai.baseUrl || undefined,
    },
    (request) => ipc.httpRequest(request),
  );
}

export function aiConfigured(): boolean {
  const { ai } = useSettings.getState();
  if (ai.provider === 'ollama' || ai.provider === 'lmstudio') return !!ai.model;
  return !!ai.apiKey && !!ai.model;
}
