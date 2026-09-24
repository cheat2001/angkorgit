import { describe, expect, it } from 'vitest';
import {
  DEMO_DOCKERFILE_PATH,
  DEMO_LESS_PATH,
  demoFileDiffFor,
  demoStatus,
} from '../../apps/desktop/src/core/demo';

describe('demo highlight fixtures', () => {
  it('keeps less and Dockerfile samples on the main demo working copy', () => {
    const paths = demoStatus.files.map((f) => f.path);
    expect(paths).toContain(DEMO_LESS_PATH);
    expect(paths).toContain(DEMO_DOCKERFILE_PATH);
  });

  it('serves highlightable diffs for less and dockerfile', () => {
    const less = demoFileDiffFor(DEMO_LESS_PATH);
    expect(less.hunks[0]?.header).toBe('@@ -1,2 +1,5 @@');
    expect(less.hunks[0]?.lines.some((l) => l.content.includes('@accent'))).toBe(true);
    expect(demoFileDiffFor(DEMO_DOCKERFILE_PATH).status).toBe('new');
    expect(
      demoFileDiffFor(DEMO_DOCKERFILE_PATH).hunks[0]?.lines.some((l) => l.content.startsWith('FROM ')),
    ).toBe(true);
  });
});
