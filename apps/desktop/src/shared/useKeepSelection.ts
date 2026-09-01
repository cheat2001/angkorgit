import { useEffect } from 'react';

export function captureSelectionRanges(): Range[] {
  const selection = window.getSelection();
  if (!selection) return [];
  return Array.from({ length: selection.rangeCount }, (_, i) =>
    selection.getRangeAt(i).cloneRange(),
  );
}

export function useKeepSelection(ranges: Range[] | null): void {
  useEffect(() => {
    if (!ranges || ranges.length === 0) return;
    const restore = () => {
      const selection = window.getSelection();
      if (!selection) return;
      if (selection.rangeCount > 0 && !selection.isCollapsed) return;
      selection.removeAllRanges();
      for (const range of ranges) selection.addRange(range);
    };
    restore();
    document.addEventListener('selectionchange', restore);
    return () => {
      document.removeEventListener('selectionchange', restore);
      restore();
    };
  }, [ranges]);
}
