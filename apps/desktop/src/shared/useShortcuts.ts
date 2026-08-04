import { useEffect } from 'react';

export interface Shortcut {
  combo: string;
  handler: (event: KeyboardEvent) => void;
  allowInInput?: boolean;
  skipInInput?: boolean;
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
  if (key === '=' && eventKey === '+') return true;
  return eventKey === key;
}

function inEditable(event: KeyboardEvent): boolean {
  const el = event.target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
}

export function useShortcuts(shortcuts: Shortcut[]): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      for (const shortcut of shortcuts) {
        if (!matches(event, shortcut.combo)) continue;
        const hasModifier = shortcut.combo.includes('mod+') || shortcut.combo.includes('alt+');
        if (shortcut.skipInInput && inEditable(event)) continue;
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
