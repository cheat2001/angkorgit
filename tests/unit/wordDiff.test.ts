import { describe, expect, it } from 'vitest';
import { wordDiff } from '@angkorgit/core';

describe('wordDiff', () => {
  it('marks identical lines as fully equal', () => {
    const { old: o, new: n } = wordDiff('const a = 1;', 'const a = 1;');
    expect(o).toEqual([{ text: 'const a = 1;', kind: 'equal' }]);
    expect(n).toEqual([{ text: 'const a = 1;', kind: 'equal' }]);
  });

  it('highlights only the changed word', () => {
    const { old: o, new: n } = wordDiff('const count = 1;', 'const total = 1;');
    expect(o.filter((s) => s.kind === 'removed').map((s) => s.text)).toEqual(['count']);
    expect(n.filter((s) => s.kind === 'added').map((s) => s.text)).toEqual(['total']);
  });

  it('handles insertion at the end', () => {
    const { new: n } = wordDiff('return value', 'return value ?? fallback');
    const added = n.filter((s) => s.kind === 'added').map((s) => s.text).join('');
    expect(added).toContain('fallback');
  });

  it('round-trips: concatenated segments equal the inputs', () => {
    const a = 'function render(items) { return items.map(f); }';
    const b = 'function render(rows) { return rows.flatMap(f); }';
    const { old: o, new: n } = wordDiff(a, b);
    expect(o.map((s) => s.text).join('')).toBe(a);
    expect(n.map((s) => s.text).join('')).toBe(b);
  });

  it('degrades to whole-line equal segments beyond the LCS cell cap', () => {
    const a = Array.from({ length: 1200 }, (_, i) => `col${i}`).join(', ');
    const b = Array.from({ length: 1200 }, (_, i) => `col${i + 1}`).join(', ');
    const start = performance.now();
    const { old: o, new: n } = wordDiff(a, b);
    expect(performance.now() - start).toBeLessThan(200);
    expect(o).toEqual([{ text: a, kind: 'equal' }]);
    expect(n).toEqual([{ text: b, kind: 'equal' }]);
  });
});
