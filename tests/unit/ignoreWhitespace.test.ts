import { describe, expect, it } from 'vitest';
import {
  DEMO_BINARY_PATH,
  DEMO_IMAGE_PATH,
  DEMO_INDENT_PATH,
  DEMO_INDENT_STAGED_PATH,
  demoFileDiffFor,
  demoStatus,
} from '../../apps/desktop/src/core/demo';

describe('ignore whitespace demo fixture', () => {
  it('keeps an indent-only file on the working copy', () => {
    expect(demoStatus.files.map((f) => f.path)).toContain(DEMO_INDENT_PATH);
  });

  it('drops the indent-only hunk when the flag is on and keeps a real token change', () => {
    const indent = demoFileDiffFor(DEMO_INDENT_PATH);
    expect(indent.additions).toBe(1);
    expect(indent.deletions).toBe(1);

    const hidden = demoFileDiffFor(DEMO_INDENT_PATH, true);
    expect(hidden.additions).toBe(0);
    expect(hidden.deletions).toBe(0);
    expect(hidden.hunks).toEqual([]);

    const staged = demoFileDiffFor(DEMO_INDENT_STAGED_PATH, true);
    expect(staged.hunks).toEqual([]);
    expect(demoStatus.files.find((file) => file.path === DEMO_INDENT_STAGED_PATH)?.staged).toBe(
      'modified',
    );

    const token = demoFileDiffFor('src/core/ipc.ts', true);
    expect(token.additions + token.deletions).toBeGreaterThan(0);
  });

  it('serves a binary file and an image with no bytes', () => {
    expect(demoFileDiffFor(DEMO_BINARY_PATH).isBinary).toBe(true);
    const image = demoFileDiffFor(DEMO_IMAGE_PATH);
    expect(image.isImage).toBe(true);
    expect(image.oldImage).toBeNull();
    expect(image.newImage).toBeNull();
  });
});
