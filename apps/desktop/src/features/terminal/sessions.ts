import type { Terminal } from '@xterm/xterm';
import type { FitAddon } from '@xterm/addon-fit';
import { ipc } from '@/core/ipc';

export interface TerminalSession {
  terminal: Terminal;
  fit: FitAddon;
  container: HTMLDivElement;
  termId: number | null;
  unlisteners: Array<() => void>;
  killed: boolean;
  exited: boolean;
}

export const sessions = new Map<string, TerminalSession>();

export function killTerminalSession(path: string): void {
  const session = sessions.get(path);
  if (!session) return;
  sessions.delete(path);
  session.killed = true;
  session.unlisteners.forEach((fn) => fn());
  if (session.termId !== null) void ipc.termKill(session.termId);
  session.terminal.dispose();
  session.container.remove();
}
