import { expect, test } from '@playwright/test';

test('splash fades into the welcome screen', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Strength. Simplicity. Craftsmanship.')).toBeVisible();
  await expect(page.getByText('Recent repositories')).toBeVisible({ timeout: 10_000 });
});

test('opens the demo repository and shows the commit graph', async ({ page }) => {
  await page.goto('/');
  await page.getByText('angkorgit', { exact: true }).first().click();
  await expect(page.getByPlaceholder('Search commits…')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('main', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Working copy')).toBeVisible();
});

test('selecting a commit opens the inspector', async ({ page }) => {
  await page.goto('/');
  await page.getByText('angkorgit', { exact: true }).first().click();
  await expect(page.getByPlaceholder('Search commits…')).toBeVisible({ timeout: 10_000 });
  await page.getByRole('row').first().click();
  await expect(page.getByText(/1 modified/)).toBeVisible();
});

test('command palette opens with keyboard shortcut', async ({ page }) => {
  await page.goto('/');
  await page.getByText('angkorgit', { exact: true }).first().click();
  await expect(page.getByPlaceholder('Search commits…')).toBeVisible({ timeout: 10_000 });
  await page.keyboard.press('ControlOrMeta+k');
  await expect(page.getByPlaceholder('Type a command or branch name…')).toBeVisible();
});

test('commit search filters the graph', async ({ page }) => {
  await page.goto('/');
  await page.getByText('angkorgit', { exact: true }).first().click();
  const search = page.getByPlaceholder('Search commits…');
  await search.fill('virtualize');
  await expect(page.getByText(/feat\(graph\): virtualize commit rows/).first()).toBeVisible();
});

test('conflict resolver picks lines into a clean output', async ({ page }) => {
  await page.goto('/');
  await page.getByText('angkorgit', { exact: true }).first().click();
  await expect(page.getByPlaceholder('Search commits…')).toBeVisible({ timeout: 10_000 });
  await page.getByText('src/features/graph/drawGraph.ts').click();
  await expect(page.getByText('0/1 resolved')).toBeVisible();
  await expect(page.getByTitle(/Unresolved conflict/).first()).toBeVisible();
  await expect(page.getByText('<<<<<<<')).toHaveCount(0);
  await page.getByLabel('Take all lines from side A').click();
  await expect(page.getByText('1/1 resolved')).toBeVisible();
  await expect(page.getByText('const palette = useThemePalette();')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Mark resolved' })).toBeEnabled();
});

test('single conflict shows jump nav and per-conflict take-all', async ({ page }) => {
  await page.goto('/');
  await page.getByText('angkorgit', { exact: true }).first().click();
  await expect(page.getByPlaceholder('Search commits…')).toBeVisible({ timeout: 10_000 });
  await page.getByText('src/features/graph/drawGraph.ts').click();
  await expect(page.getByText('0/1 resolved')).toBeVisible();
  await expect(page.getByLabel('Next conflict')).toBeVisible();
  await expect(page.getByText('Conflict 1 of 1')).toBeVisible();
  await page.getByLabel('Take all lines from B for this conflict').click();
  await expect(page.getByText('1/1 resolved')).toBeVisible();
  await page.getByLabel('Take all lines from B for this conflict').click();
  await expect(page.getByText('0/1 resolved')).toBeVisible();
  await page.getByTitle(/Unresolved conflict/).first().click();
  const editor = page.getByLabel('Hand-edited result for this conflict');
  await expect(editor).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(editor).toBeHidden();
  await expect(page.getByText('0/1 resolved')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mark resolved' })).toBeDisabled();
});

test('conflict result can be hand-edited per block', async ({ page }) => {
  await page.goto('/');
  await page.getByText('angkorgit', { exact: true }).first().click();
  await expect(page.getByPlaceholder('Search commits…')).toBeVisible({ timeout: 10_000 });
  await page.getByText('src/features/graph/drawGraph.ts').click();
  await expect(page.getByText('0/1 resolved')).toBeVisible();
  await page.getByTitle(/Unresolved conflict/).first().click();
  const editor = page.getByLabel('Hand-edited result for this conflict');
  await expect(editor).toBeVisible();
  await editor.fill('const palette = mergedThemePalette();');
  await expect(page.getByText('1/1 resolved')).toBeVisible();
  await page.getByText('Output', { exact: true }).click();
  await expect(editor).toBeHidden();
  await expect(page.getByText('const palette = mergedThemePalette();')).toBeVisible();
  await expect(page.getByText('1 edited by hand')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mark resolved' })).toBeEnabled();
  await page.getByText('const palette = mergedThemePalette();').click();
  await expect(editor).toBeVisible();
  await editor.fill('scrapped');
  await page.keyboard.press('Escape');
  await expect(editor).toBeHidden();
  await expect(page.getByText('const palette = mergedThemePalette();')).toBeVisible();
  await expect(page.getByText('scrapped')).toBeHidden();
  await expect(page.getByText('1/1 resolved')).toBeVisible();
});

test('interactive rebase dialog opens from the commit context menu', async ({ page }) => {
  await page.goto('/');
  await page.getByText('angkorgit', { exact: true }).first().click();
  await expect(page.getByPlaceholder('Search commits…')).toBeVisible({ timeout: 10_000 });
  await page.getByRole('row').nth(3).click({ button: 'right' });
  await page.getByRole('menuitem', { name: /Interactively rebase onto here/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Interactive rebase')).toBeVisible();
  await expect(dialog.getByRole('listitem').first()).toBeVisible();
  await expect(dialog.getByRole('combobox').first()).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
});

test('cherry-pick opens a dialog with the source reference option', async ({ page }) => {
  await page.goto('/');
  await page.getByText('angkorgit', { exact: true }).first().click();
  await expect(page.getByPlaceholder('Search commits…')).toBeVisible({ timeout: 10_000 });
  await page.getByRole('row').nth(3).click({ button: 'right' });
  await page.getByRole('menuitem', { name: /Cherry-pick onto current branch/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Cherry-pick commit')).toBeVisible();
  await expect(dialog.getByRole('checkbox')).toBeChecked();
  await expect(dialog.getByText(/cherry picked from commit/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Cherry-pick', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByText('Cherry-picked (demo)')).toBeVisible();
});

test('multi-select cherry-pick lists every commit in the dialog', async ({ page }) => {
  await page.goto('/');
  await page.getByText('angkorgit', { exact: true }).first().click();
  await expect(page.getByPlaceholder('Search commits…')).toBeVisible({ timeout: 10_000 });
  await page.getByRole('row').nth(1).click();
  await page.getByRole('row').nth(2).click({ modifiers: ['ControlOrMeta'] });
  await page.getByRole('row').nth(2).click({ button: 'right' });
  await page
    .getByRole('menuitem', { name: /Cherry-pick 2 commits onto current branch/ })
    .click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Cherry-pick 2 commits' })).toBeVisible();
  await expect(dialog.getByText(/oldest first/)).toBeVisible();
  await expect(dialog.locator('.font-mono')).toHaveCount(2);
  await dialog.getByRole('button', { name: 'Cherry-pick 2 commits' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByText('Cherry-picked 2 commits (demo)')).toBeVisible();
});

test('multi-select offers squash and pre-fills the rebase plan', async ({ page }) => {
  await page.goto('/');
  await page.getByText('angkorgit', { exact: true }).first().click();
  await expect(page.getByPlaceholder('Search commits…')).toBeVisible({ timeout: 10_000 });
  await page.getByRole('row').nth(1).click();
  await page.getByRole('row').nth(2).click({ modifiers: ['ControlOrMeta'] });
  await page.getByRole('row').nth(2).click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Drop 2 commits' })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Squash 2 commits' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('listitem').first()).toBeVisible();
  await expect(dialog.getByRole('combobox').filter({ hasText: 'squash' })).toHaveCount(1);
  await expect(dialog.getByPlaceholder('Combined message (optional)')).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
});

test('clicking a file opens the diff already at its first change, with no scroll animation', async ({ page }) => {
  await page.goto('/');
  await page.getByText('angkorgit', { exact: true }).first().click();
  await expect(page.getByPlaceholder('Search commits…')).toBeVisible({ timeout: 10_000 });
  const trace = page.evaluate(async () => {
    const samples: number[] = [];
    const started = performance.now();
    while (performance.now() - started < 1_000) {
      const el = document.querySelector('section[aria-label^="Diff for"] div.overflow-y-auto');
      if (el) samples.push(el.scrollTop);
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    return samples;
  });
  await page.getByText('palette-seed.sql').first().click();
  await expect(page.getByText('temple gold').first()).toBeVisible();
  const samples = await trace;
  const settled = samples[samples.length - 1];
  expect(settled).toBeGreaterThan(1_000);
  const climbing = samples.filter((top) => top > 0 && top < settled * 0.9);
  expect(climbing).toHaveLength(0);
});

test('long paths stay inside confirmation dialogs', async ({ page }) => {
  await page.goto('/');
  await page.getByText('angkorgit', { exact: true }).first().click();
  await expect(page.getByPlaceholder('Search commits…')).toBeVisible({ timeout: 10_000 });

  const longPath =
    'src/features/repository/components/working-copy/deeply/nested/WorkingCopyFileListItemContainerFactory.tsx';

  const measure = () =>
    page.getByRole('dialog').evaluate((box) => {
      const outer = box.getBoundingClientRect();
      return [...box.querySelectorAll('h2, p')].map((el) => {
        const rect = el.getBoundingClientRect();
        return {
          text: (el.textContent ?? '').slice(0, 40),
          clipped: el.scrollWidth - el.clientWidth,
          spillsRight: Math.round(rect.right - outer.right),
        };
      });
    });

  const expectContained = async () => {
    const parts = await measure();
    expect(parts.length).toBeGreaterThan(0);
    for (const part of parts) {
      expect(part.clipped, `clipped: ${part.text}`).toBeLessThanOrEqual(1);
      expect(part.spillsRight, `spills: ${part.text}`).toBeLessThanOrEqual(0);
    }
  };

  const discard = page.getByRole('button', { name: `Discard ${longPath}` });
  await discard.scrollIntoViewIfNeeded();
  await discard.click({ force: true });
  await expect(page.getByRole('dialog').getByText('Discard changes?')).toBeVisible();
  await expect(page.getByRole('dialog').getByText(longPath)).toBeVisible();
  await expectContained();
  await page.getByRole('button', { name: 'Cancel' }).click();

  await page
    .getByText('WorkingCopyFileListItemContainerFactory.tsx')
    .first()
    .click({ button: 'right' });
  await page.getByRole('menuitem', { name: /Delete file/ }).click();
  await expect(page.getByRole('dialog').getByText('Delete file?')).toBeVisible();
  await expect(page.getByRole('dialog').getByText(longPath)).toBeVisible();
  await expectContained();
});

test('branch names line up whether or not the branch is checked out', async ({ page }) => {
  await page.goto('/');
  await page.getByText('angkorgit', { exact: true }).first().click();
  await expect(page.getByPlaceholder('Search commits…')).toBeVisible({ timeout: 10_000 });
  await page.locator('aside button[title="feature"]').click();

  const layout = await page.evaluate(() => {
    const leftOf = (el: Element | null) =>
      el ? Math.round((el as HTMLElement).getBoundingClientRect().left) : -1;
    const branch = (name: string) => {
      const row = [...document.querySelectorAll('aside div[title*="drag onto another branch"]')].find(
        (el) => (el.getAttribute('title') ?? '').startsWith(`${name} —`),
      );
      return {
        left: leftOf(row?.querySelector('button span.truncate') ?? null),
        tick: !!row?.querySelector('svg.lucide-check'),
      };
    };
    return {
      head: branch('main'),
      plain: branch('develop'),
      nested: branch('feature/diff-viewer'),
      folder: leftOf(document.querySelector('aside button[title="feature"] span.truncate')),
    };
  });

  expect(layout.head.tick).toBe(true);
  expect(layout.plain.tick).toBe(false);
  expect(layout.head.left).toBe(layout.plain.left);
  expect(layout.folder).toBe(layout.plain.left);
  expect(layout.nested.left).toBe(layout.plain.left + 14);
});

test('hovering a working copy file reveals its full path', async ({ page }) => {
  await page.goto('/');
  await page.getByText('angkorgit', { exact: true }).first().click();
  await expect(page.getByPlaceholder('Search commits…')).toBeVisible({ timeout: 10_000 });

  const longPath =
    'src/features/repository/components/working-copy/deeply/nested/WorkingCopyFileListItemContainerFactory.tsx';
  await page.getByText('WorkingCopyFileListItemContainerFactory.tsx').first().hover();
  await expect(page.getByRole('tooltip').filter({ hasText: longPath })).toBeVisible();
});

test('avatars stay visible after opening and closing a diff', async ({ page }) => {
  const pixel = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  await page.route('**://www.gravatar.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: pixel }),
  );

  const visibleAvatars = () =>
    page.evaluate(
      () =>
        [...document.querySelectorAll('img[src*="gravatar"]')].filter(
          (img) => getComputedStyle(img).opacity === '1',
        ).length,
    );

  await page.goto('/');
  await page.getByText('angkorgit', { exact: true }).first().click();
  await expect(page.getByPlaceholder('Search commits…')).toBeVisible({ timeout: 10_000 });
  await expect.poll(visibleAvatars, { timeout: 10_000 }).toBeGreaterThan(0);

  await page.getByText('palette-seed.sql').first().click();
  await expect(page.getByRole('button', { name: 'Close diff' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByPlaceholder('Search commits…')).toBeVisible();
  await expect.poll(visibleAvatars, { timeout: 10_000 }).toBeGreaterThan(0);
});

test('text selection in a diff survives the right-click copy menu', async ({ page }) => {
  await page.goto('/');
  await page.getByText('angkorgit', { exact: true }).first().click();
  await page.getByText('palette-seed.sql').first().click();
  await page.waitForSelector('[data-diff-layer]', { timeout: 10_000 });

  const selectRows = () =>
    page.evaluate(() => {
      const rows = [...document.querySelectorAll('[data-diff-layer] > div')];
      const range = document.createRange();
      range.setStartBefore(rows[2]);
      range.setEndAfter(rows[5]);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    });
  const selectionLength = () =>
    page.evaluate(() => window.getSelection()?.toString().trim().length ?? 0);
  const row = page.locator('[data-diff-layer] > div').nth(3);

  await selectRows();
  await row.click({ button: 'right', position: { x: 60, y: 8 } });
  const copyLine = page.getByRole('menuitem', { name: 'Copy line' });
  await expect(copyLine).toBeVisible();
  await expect.poll(selectionLength).toBeGreaterThan(0);
  await copyLine.click();
  await expect(copyLine).not.toBeVisible();
  await expect.poll(selectionLength).toBeGreaterThan(0);

  await row.click({ button: 'right', position: { x: 60, y: 8 } });
  await expect(copyLine).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(copyLine).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Close diff' })).toBeVisible();
  await expect.poll(selectionLength).toBeGreaterThan(0);
});

test('commit actions stay inside a narrow working copy panel', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 800 });
  await page.goto('/');
  await page.getByText('angkorgit', { exact: true }).first().click();
  await expect(page.getByPlaceholder('Search commits…')).toBeVisible({ timeout: 10_000 });

  const inspector = page.locator('aside[aria-label="Inspector"]');
  const panel = await inspector.boundingBox();
  expect(panel).not.toBeNull();

  for (const name of ['Review', /Commit \d+ files?/] as const) {
    const button = inspector.getByRole('button', { name });
    await expect(button).toBeVisible();
    const box = await button.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x + box!.width, `${String(name)} spills right`).toBeLessThanOrEqual(
      panel!.x + panel!.width + 1,
    );
    expect(box!.x, `${String(name)} spills left`).toBeGreaterThanOrEqual(panel!.x - 1);
  }
});

test('opening a diff hides the sidebar and toggling it back returns to the graph', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByText('angkorgit', { exact: true }).first().click();
  await expect(page.getByPlaceholder('Search commits…')).toBeVisible({ timeout: 10_000 });

  const sidebar = page.getByRole('complementary', { name: 'Branches and refs' });
  const diff = page.locator('section[aria-label^="Diff for"]');
  const toggle = page.getByRole('button', { name: /sidebar$/ });

  await expect(sidebar).toBeVisible();
  await page.getByText('palette-seed.sql').first().click();
  await expect(diff).toBeVisible();
  await expect(sidebar).toBeHidden();

  const stored = await page.evaluate(() => {
    const raw = localStorage.getItem('angkorgit-ui');
    return raw ? JSON.parse(raw).state.sidebarOpen : null;
  });
  expect(stored).toBe(true);

  await toggle.click();
  await expect(sidebar).toBeVisible();
  await expect(diff).toBeHidden();

  await toggle.click();
  await expect(sidebar).toBeHidden();
  await page.getByText('palette-seed.sql').first().click();
  await expect(diff).toBeVisible();
  await toggle.click();
  await expect(sidebar).toBeVisible();
  await expect(diff).toBeHidden();
});

test('sidebar lists demo pull requests and opens the create dialog', async ({ page }) => {
  await page.goto('/');
  await page.getByText('angkorgit', { exact: true }).first().click();
  await expect(page.getByPlaceholder('Search commits…')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Pull requests')).toBeVisible();
  await expect(page.getByText(/side-by-side word diff polish/)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Draft', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Create pull request', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Create pull request' })).toBeVisible();
  await expect(page.getByPlaceholder('Title')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('heading', { name: 'Create pull request' })).toBeHidden();

  await page.getByRole('button', { name: 'Create pull request', exact: true }).click();
  await page.getByRole('button', { name: 'Add reviewers' }).click();
  await expect(page.getByRole('menuitemcheckbox', { name: /Dara Kim/ })).toBeVisible();
});

test('searching a commit hash jumps to it in the full graph', async ({ page }) => {
  await page.goto('/');
  await page.getByText('angkorgit', { exact: true }).first().click();
  const search = page.getByPlaceholder('Search commits…');
  await expect(search).toBeVisible({ timeout: 10_000 });
  await search.fill('000096aaaaaa');
  await expect(page.getByText('400 commits')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('000096aa').first()).toBeVisible();

  await page.getByText('fix(diff): handle renamed files in word diff').first().click();
  await expect(search).toHaveValue('');
  await expect(page.getByText('400 commits')).toBeVisible();
});

test('a short hash prefix jumps like a full hash and unknown hex words fall back to filtering', async ({ page }) => {
  await page.goto('/');
  await page.getByText('angkorgit', { exact: true }).first().click();
  const search = page.getByPlaceholder('Search commits…');
  await expect(search).toBeVisible({ timeout: 10_000 });

  await search.fill('000096');
  await expect(page.getByText('400 commits')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('000096aa').first()).toBeVisible();

  await search.fill('dedede');
  await expect(page.getByText('No commits found')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Commit not found')).not.toBeVisible();
});

test('searching a hash that does not exist keeps the graph and says so', async ({ page }) => {
  await page.goto('/');
  await page.getByText('angkorgit', { exact: true }).first().click();
  const search = page.getByPlaceholder('Search commits…');
  await expect(search).toBeVisible({ timeout: 10_000 });
  await search.fill('deadbeef123');
  await expect(page.getByText('Commit not found')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/200 commits\+/)).toBeVisible();
});

test('mod+f focuses the commit search box', async ({ page }) => {
  await page.goto('/');
  await page.getByText('angkorgit', { exact: true }).first().click();
  const search = page.getByPlaceholder('Search commits…');
  await expect(search).toBeVisible({ timeout: 10_000 });
  await page.keyboard.press('ControlOrMeta+f');
  await expect(search).toBeFocused();
});

test('sidebar lists the demo worktrees and the new worktree dialog opens', async ({ page }) => {
  await page.goto('/');
  await page.getByText('angkorgit', { exact: true }).first().click();
  await expect(page.getByPlaceholder('Search commits…')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Worktrees', { exact: true })).toBeVisible();
  await expect(page.getByText('angkorgit-feature-diff-viewer')).toBeVisible();
  await expect(page.getByText('folder missing')).toBeVisible();
  await page.getByRole('button', { name: 'New worktree' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('New worktree')).toBeVisible();
  await expect(dialog.getByPlaceholder('/path/to/new-folder')).toHaveValue(
    '/Users/demo/projects/angkorgit-new',
  );
  await dialog.getByPlaceholder('feature/parallel-task').fill('feature/parallel agents');
  await expect(dialog.getByPlaceholder('/path/to/new-folder')).toHaveValue(
    '/Users/demo/projects/angkorgit-feature-parallel-agents',
  );
});

test('multi-line comments in a diff stay highlighted as comments', async ({ page }) => {
  await page.goto('/');
  await page.getByText('angkorgit', { exact: true }).first().click();
  await expect(page.getByPlaceholder('Search commits…')).toBeVisible({ timeout: 10_000 });
  await page.getByText('CommitGraph.tsx').first().click();
  const inner = page
    .locator('section[aria-label^="Diff for"] span.font-mono')
    .filter({ hasText: 'Virtualized rows keep large graphs smooth' })
    .first();
  await expect(inner).toBeVisible();
  const html = await inner.evaluate((el) => el.innerHTML);
  expect(html.startsWith('<span class="hljs-comment">')).toBe(true);
  expect(html).not.toContain('hljs-keyword');
  expect(html).not.toContain('hljs-title');
});

test('collapse all folds every sidebar section and branch folder', async ({ page }) => {
  await page.goto('/');
  await page.getByText('angkorgit', { exact: true }).first().click();
  await expect(page.getByPlaceholder('Search commits…')).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: /^feature 1$/ }).click();
  await expect(page.getByText('diff-viewer', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^Remotes/ }).click();
  await expect(page.getByRole('button', { name: /^Remotes/ })).toHaveAttribute('aria-expanded', 'true');
  await page.getByRole('button', { name: 'Collapse all sections' }).click();
  for (const name of [/^Branches/, /^Worktrees/, /^Remotes/, /^Tags/, /^Stashes/]) {
    await expect(page.getByRole('button', { name })).toHaveAttribute('aria-expanded', 'false');
  }
  await expect(page.getByText('develop', { exact: true })).toBeHidden();
  await page.getByRole('button', { name: /^Branches/ }).click();
  await expect(page.getByText('develop', { exact: true })).toBeVisible();
  await expect(page.getByText('diff-viewer', { exact: true })).toBeHidden();
});

test('opening a diff keeps the inspector at the same width', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByText('angkorgit', { exact: true }).first().click();
  await expect(page.getByPlaceholder('Search commits…')).toBeVisible({ timeout: 10_000 });
  const inspector = page.locator('[data-panel-id="inspector"]');
  const sidebar = page.locator('[data-panel-id="sidebar"]');
  const handle = page.locator('[data-panel-resize-handle-id]').first();
  const grip = await handle.boundingBox();
  if (!grip) throw new Error('no sidebar resize handle');
  await page.mouse.move(grip.x + grip.width / 2, grip.y + 300);
  await page.mouse.down();
  await page.mouse.move(grip.x + 80, grip.y + 300, { steps: 8 });
  await page.mouse.up();
  const sidebarBefore = (await sidebar.boundingBox())?.width ?? 0;
  const inspectorBefore = (await inspector.boundingBox())?.width ?? 0;
  expect(sidebarBefore).toBeGreaterThan(200);

  await page.getByText('CommitGraph.tsx').first().click();
  await expect(page.locator('section[aria-label^="Diff for"]')).toBeVisible();
  expect((await sidebar.boundingBox())?.width ?? 0).toBeLessThan(2);
  const inspectorDuring = (await inspector.boundingBox())?.width ?? 0;
  expect(Math.abs(inspectorDuring - inspectorBefore)).toBeLessThan(2);

  await page.keyboard.press('Escape');
  await expect(page.getByPlaceholder('Search commits…')).toBeVisible();
  expect(Math.abs(((await sidebar.boundingBox())?.width ?? 0) - sidebarBefore)).toBeLessThan(2);
  expect(Math.abs(((await inspector.boundingBox())?.width ?? 0) - inspectorBefore)).toBeLessThan(2);
});
