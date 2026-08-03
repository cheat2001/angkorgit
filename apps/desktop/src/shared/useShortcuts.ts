import { useEffect } from 'react';

export interface Shortcut {
  /** e.g. "mod+k", "mod+shift+p", "escape" */
  combo: string;
  handler: (event: KeyboardEvent) => void;
  /** allow firing while an input/textarea is focused */
  allowInInput?: boolean;
}

function matches(event: KeyboardEvent, combo: string): boolean {
  const parts = combo.toLowerCase().split('+');
  const key = parts[parts.length - 1] || '+'; // "mod+shift+=" style combos
  const needMod = parts.includes('mod');
  const needShift = parts.includes('shift');
  const needAlt = parts.includes('alt');
  const mod = event.metaKey || event.ctrlKey;
  if (needMod !== mod) return false;
  if (needShift !== event.shiftKey) return false;
  if (needAlt !== event.altKey) return false;
  const eventKey = event.key.toLowerCase();
  // Shifted "=" produces "+": accept it for zoom-style combos.
  if (key === '=' && eventKey === '+') return true;
  return eventKey === key;
}

function inEditable(event: KeyboardEvent): boolean {
  const el = event.target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
}

/**
 * Registers global keyboard shortcuts. Handlers with a modifier fire even in
 * inputs; bare-key shortcuts are suppressed while typing unless opted in.
 */
export function useShortcuts(shortcuts: Shortcut[]): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      for (const shortcut of shortcuts) {
        if (!matches(event, shortcut.combo)) continue;
        const hasModifier = shortcut.combo.includes('mod+') || shortcut.combo.includes('alt+');
        if (!hasModifier && !shortcut.allowInInput && inEditable(event)) continue;
        event.preventDefault();
        shortcut.handler(event);
        return;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [shortcuts]);
}
