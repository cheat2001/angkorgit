import { createAiProvider, type AiProvider } from '@angkorgit/core';
import { ipc } from '@/core/ipc';
import { useSettings } from '@/features/settings/store';

export function getAiProvider(): AiProvider {
  const { ai } = useSettings.getState();
  return createAiProvider(
    {
      ...ai,
      baseUrl: ai.baseUrl || undefined,
    },
    (request) => ipc.httpRequest(request),
    (request) => ipc.aiCliRun(request),
  );
}

export function aiConfigured(): boolean {
  const { ai } = useSettings.getState();
  if (ai.provider === 'cli') return !!ai.cliAgent;
  if (ai.provider === 'ollama' || ai.provider === 'lmstudio') return !!ai.model;
  return !!ai.apiKey && !!ai.model;
}
