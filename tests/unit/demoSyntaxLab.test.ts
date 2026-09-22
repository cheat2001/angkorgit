import { describe, expect, it } from 'vitest';
import {
  DEMO_DOCKERFILE_PATH,
  DEMO_GITIGNORE_PATH,
  DEMO_LESS_PATH,
  DEMO_SCSS_PATH,
  DEMO_SYNTAX_REPO_PATH,
  demoFileDiffFor,
  demoRecents,
  demoRepoAt,
  demoStatus,
  demoStatusAt,
} from '../../apps/desktop/src/core/demo';

describe('syntax-lab demo fixture', () => {
  it('is a recent with only suffix samples', () => {
    expect(demoRecents.some((r) => r.path === DEMO_SYNTAX_REPO_PATH && r.name === 'syntax-lab')).toBe(
      true,
    );
    expect(demoRepoAt(DEMO_SYNTAX_REPO_PATH)).toMatchObject({
      name: 'syntax-lab',
      path: DEMO_SYNTAX_REPO_PATH,
    });
    expect(demoStatus.files.some((f) => f.path === DEMO_LESS_PATH)).toBe(false);
    const files = demoStatusAt(DEMO_SYNTAX_REPO_PATH).files;
    expect(files.map((f) => f.path)).toContain(DEMO_LESS_PATH);
    expect(files.map((f) => f.path)).toContain(DEMO_DOCKERFILE_PATH);
    expect(demoStatusAt(DEMO_SYNTAX_REPO_PATH)).toMatchObject({ ahead: 0, behind: 0 });
  });

  it('serves highlightable diffs for less, scss, dockerfile, and gitignore', () => {
    expect(demoFileDiffFor(DEMO_LESS_PATH).hunks[0]?.lines.some((l) => l.content.includes('@accent'))).toBe(
      true,
    );
    expect(demoFileDiffFor(DEMO_SCSS_PATH).hunks[0]?.lines.some((l) => l.content.includes('$radius'))).toBe(
      true,
    );
    expect(demoFileDiffFor(DEMO_DOCKERFILE_PATH).status).toBe('new');
    expect(
      demoFileDiffFor(DEMO_GITIGNORE_PATH).hunks[0]?.lines.some((l) => l.content === '.env.local'),
    ).toBe(true);
  });
});
