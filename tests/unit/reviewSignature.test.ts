import { describe, expect, it } from 'vitest';
import { buildStagedReviewSignature, hashText } from '@angkorgit/core';

const file = (path: string, staged: string | null, unstaged: string | null) => ({
  path,
  staged,
  unstaged,
});

describe('buildStagedReviewSignature', () => {
  it('includes only staged files', () => {
    expect(
      buildStagedReviewSignature([file('a.ts', 'modified', null), file('b.ts', null, 'modified')]),
    ).toBe(buildStagedReviewSignature([file('a.ts', 'modified', null)]));
  });

  it('is order-insensitive', () => {
    const one = buildStagedReviewSignature([file('a.ts', 'modified', null), file('b.ts', 'new', null)]);
    const two = buildStagedReviewSignature([file('b.ts', 'new', null), file('a.ts', 'modified', null)]);
    expect(one).toBe(two);
  });

  it('changes when a staged file gains an unstaged edit', () => {
    const before = buildStagedReviewSignature([file('a.ts', 'modified', null)]);
    const after = buildStagedReviewSignature([file('a.ts', 'modified', 'modified')]);
    expect(before).not.toBe(after);
  });

  it('changes when the staged set changes', () => {
    const before = buildStagedReviewSignature([file('a.ts', 'modified', null)]);
    const after = buildStagedReviewSignature([
      file('a.ts', 'modified', null),
      file('b.ts', 'new', null),
    ]);
    expect(before).not.toBe(after);
  });

  it('does not collide on filenames containing newlines', () => {
    const tricky = buildStagedReviewSignature([file('a\n.ts', 'modified', null)]);
    const plain = buildStagedReviewSignature([
      file('a', 'modified', null),
      file('.ts', 'modified', null),
    ]);
    expect(tricky).not.toBe(plain);
  });
});

describe('hashText', () => {
  it('differs for different content and repeats for identical content', () => {
    expect(hashText('diff a')).toBe(hashText('diff a'));
    expect(hashText('diff a')).not.toBe(hashText('diff b'));
  });

  it('includes length so truncation-style collisions differ', () => {
    expect(hashText('')).not.toBe(hashText(' '));
  });
});
