import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import type { FileDiff } from '@angkorgit/core';
import { useUi } from '@/features/ui/store';

interface CaretState {
  layer: HTMLElement;
  left: number;
  top: number;
  height: number;
}

export type DiffSide = 'old' | 'new';

export function diffText(diff: FileDiff, side: DiffSide): string {
  const skip = side === 'new' ? 'deletion' : 'addition';
  const out: string[] = [];
  for (const hunk of diff.hunks) {
    for (const line of hunk.lines) {
      if (line.kind !== skip) out.push(line.content);
    }
  }
  return out.join('\n');
}

function copySide(diff: FileDiff, side: DiffSide): void {
  const text = diffText(diff, side);
  void navigator.clipboard.writeText(text);
  const lines = text.length === 0 ? 0 : text.split('\n').length;
  toast.success(`Copied ${lines} line${lines === 1 ? '' : 's'} (${side} text)`);
}

const isEditableTarget = (): boolean => {
  const el = document.activeElement as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
};

export function useDiffSelectAll(diff: FileDiff | null, scrollRef: React.RefObject<HTMLDivElement>) {
  const { diffView, wrapLines } = useUi();
  const [selectedSide, setSelectedSide] = useState<DiffSide | null>(null);
  const [activeSide, setActiveSide] = useState<DiffSide>('new');
  const [caretPos, setCaretPos] = useState<CaretState | null>(null);

  useEffect(() => {
    setSelectedSide(null);
    setActiveSide('new');
    setCaretPos(null);
  }, [diff, diffView, wrapLines]);

  useEffect(() => {
    if (!diff) return;
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'a' && !isEditableTarget()) {
        e.preventDefault();
        window.getSelection()?.removeAllRanges();
        setSelectedSide(activeSide);
      } else if (mod && e.key.toLowerCase() === 'c' && selectedSide && !isEditableTarget()) {
        e.preventDefault();
        copySide(diff, selectedSide);
      } else if (e.key === 'Escape' && selectedSide) {
        e.stopPropagation();
        setSelectedSide(null);
      }
    };
    const onMouseDown = (e: MouseEvent) => {
      setSelectedSide(null);
      const target = e.target as HTMLElement | null;
      const pane = target?.closest?.('[data-diff-pane]') as HTMLElement | null;
      const side = pane?.dataset.diffPane;
      if (side === 'old' || side === 'new') setActiveSide(side);
      if (!pane || target?.closest('button')) {
        setCaretPos(null);
        return;
      }
      const layer = pane.querySelector<HTMLElement>('[data-diff-layer]');
      const range = document.caretRangeFromPoint?.(e.clientX, e.clientY);
      if (!layer || !range) {
        setCaretPos(null);
        return;
      }
      const rect = range.getBoundingClientRect();
      const base = layer.getBoundingClientRect();
      if (rect.height > 0) {
        setCaretPos({ layer, left: rect.left - base.left, top: rect.top - base.top, height: rect.height });
      } else {
        setCaretPos({ layer, left: e.clientX - base.left, top: e.clientY - base.top - 8, height: 16 });
      }
    };
    window.addEventListener('keydown', onKey, { capture: true });
    window.addEventListener('mousedown', onMouseDown);
    return () => {
      window.removeEventListener('keydown', onKey, { capture: true });
      window.removeEventListener('mousedown', onMouseDown);
    };
  }, [diff, activeSide, selectedSide]);

  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const panes = root.querySelectorAll<HTMLElement>('[data-diff-pane]');
    panes.forEach((pane) => {
      pane.classList.toggle(
        'diff-pane-selected',
        selectedSide !== null && pane.dataset.diffPane === selectedSide,
      );
    });
    return () => panes.forEach((pane) => pane.classList.remove('diff-pane-selected'));
  }, [selectedSide, scrollRef, diff]);

  const selectSide = (side: DiffSide) => {
    window.getSelection()?.removeAllRanges();
    setActiveSide(side);
    setSelectedSide(side);
  };

  const selectAllOverlay = (
    <>
      {selectedSide && (
        <div className="pointer-events-none absolute left-1/2 top-2 z-20 -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-surface-overlay px-2.5 py-1 text-[11px] text-muted shadow-soft">
          {selectedSide === 'old' ? 'Old' : 'New'} text selected — ⌘C to copy · Esc to clear
        </div>
      )}
      {caretPos &&
        createPortal(
          <span
            className="diff-caret"
            style={{ left: caretPos.left, top: caretPos.top, height: caretPos.height }}
          />,
          caretPos.layer,
        )}
    </>
  );

  return { selectAllOverlay, selectSide };
}
