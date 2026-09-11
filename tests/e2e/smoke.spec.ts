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
  await expect(page.getByRole('complementary', { name: 'Inspector' }).getByLabel('4 modified')).toBeVisible();
});

test('command palette opens with keyboard shortcut', async ({ page }) => {
  await page.goto('/');
  await page.getByText('angkorgit', { exact: true }).first().click();
  await expect(page.getByPlaceholder('Search commits…')).toBeVisible({ timeout: 10_000 });
  await page.keyboard.press('ControlOrMeta+k');
  await expect(page.getByPlaceholder('Type a command or branch name…')).toBeVisible();
});

test('commit search finds matches in the full graph and steps through them', async ({ page }) => {
  await page.goto('/');
  await page.getByText('angkorgit', { exact: true }).first().click();
  const search = page.getByPlaceholder('Search commits…');
  await expect(search).toBeVisible({ timeout: 10_000 });
  await search.fill('virtualize');
  await expect(page.getByText(/^1 of \d+$/)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/200\+ commits/)).toBeVisible();
  await expect(page.locator('[data-search-match="active"]')).toHaveText(/virtualize commit rows/);
  await expect(page.locator('[data-search-match]').first()).toBeVisible();
  await search.press('Enter');
  await expect(page.getByText(/^2 of \d+$/)).toBeVisible();
  await page.getByLabel('Previous match').click();
  await expect(page.getByText(/^1 of \d+$/)).toBeVisible();
  await page.getByText('fix(diff): handle renamed files in word diff').first().click();
  await expect(search).toHaveValue('virtualize');
  await expect(page.locator('[data-search-match="active"]')).toHaveCount(0);
  await search.press('Escape');
  await expect(search).toHaveValue('');
  await expect(page.getByText(/^1 of \d+$/)).toBeHidden();
});

test('the author box finds commits without flattening the graph', async ({ page }) => {
  await page.goto('/');
  await page.getByText('angkorgit', { exact: true }).first().click();
  const author = page.getByPlaceholder('Find author…');
  await expect(author).toBeVisible({ timeout: 10_000 });
  await author.fill('Dara');
  await expect(page.getByText(/^1 of \d+$/)).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('[data-search-match="active"]')).toContainText('Dara Kim');
  await expect(page.getByText(/200\+ commits/)).toBeVisible();
  await expect(page.locator('[data-graph-tail]').first()).toBeVisible();
  await page.getByPlaceholder('Search commits…').fill('renamed');
  await expect(page.locator('[data-search-match="active"]')).toContainText('fix(diff): handle renamed files');
  await author.press('Enter');
  await expect(page.getByText(/^2 of \d+$/)).toBeVisible();
});

test('reconnecting an account opens the token form with the account prefilled', async ({ page }) => {
  await page.goto('/');
  await page.getByText('angkorgit', { exact: true }).first().click();
  await expect(page.getByPlaceholder('Search commits…')).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Authentication', exact: true }).click();
  await expect(dialog.getByText('demo-user', { exact: true })).toBeVisible();
  await expect(dialog.getByPlaceholder('Paste the token')).toBeHidden();
  await dialog.getByRole('button', { name: 'demo-user on github.com actions' }).click();
  await page.getByRole('menuitem', { name: /Reconnect with a new token/ }).click();
  const token = dialog.getByPlaceholder('Paste the token');
  await expect(token).toBeVisible();
  await expect(token).toBeFocused();
  await expect
    .poll(() => dialog.locator('input').evaluateAll((els) => els.map((el) => (el as HTMLInputElement).value)))
    .toEqual(expect.arrayContaining(['demo-user', 'github.com']));
});

test('a file history row can open the full commit in the graph', async ({ page }) => {
  await page.goto('/');
  await page.getByText('angkorgit', { exact: true }).first().click();
  await expect(page.getByPlaceholder('Search commits…')).toBeVisible({ timeout: 10_000 });
  await page.getByText('CommitGraph.tsx').first().click();
  await page.locator('section[aria-label^="Diff for"]').getByRole('button', { name: 'File history' }).click();
  const history = page.locator('section[aria-label^="History of"]');
  await expect(history).toBeVisible();
  const firstRow = history.getByRole('button', { name: /^Open commit [0-9a-f]+$/ }).first();
  await firstRow.focus();
  const label = await firstRow.getAttribute('aria-label');
  const short = label?.replace('Open commit ', '') ?? '';
  await firstRow.click();
  await expect(history).toBeHidden();
  await expect(page.getByPlaceholder('Search commits…')).toBeVisible();
  const inspector = page.getByLabel('Inspector');
  await expect(inspector.getByText('Commit', { exact: true })).toBeVisible();
  await expect(inspector.getByText(new RegExp(`^${short}`)).first()).toBeVisible();
  await expect(page.locator('[role="row"][aria-selected="true"]')).toContainText(short.slice(0, 7));
});

test('conflict resolver picks lines into a clean output', async ({ page }) => {
  await page.goto('/');
  await page.getByText('angkorgit', { exact: true }).first().click();
  await expect(page.getByPlaceholder('Search commits…')).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: /drawGraph\.ts/ }).first().click();
  await expect(page.getByText('0 of 1 resolved')).toBeVisible();
  await expect(page.getByTitle(/Unresolved conflict/).first()).toBeVisible();
  await expect(page.getByText('<<<<<<<')).toHaveCount(0);
  await page.getByLabel('Take all lines from side A').click();
  await expect(page.getByText('1 of 1 resolved')).toBeVisible();
  await expect(page.getByText('const palette = useThemePalette();')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Mark resolved' })).toBeEnabled();
});

test('single conflict shows jump nav and per-conflict take-all', async ({ page }) => {
  await page.goto('/');
  await page.getByText('angkorgit', { exact: true }).first().click();
  await expect(page.getByPlaceholder('Search commits…')).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: /drawGraph\.ts/ }).first().click();
  await expect(page.getByText('0 of 1 resolved')).toBeVisible();
  await expect(page.getByLabel('Next conflict')).toBeVisible();
  await expect(page.getByText('Conflict 1 of 1')).toBeVisible();
  await page.getByLabel('Take all lines from B for this conflict').click();
  await expect(page.getByText('1 of 1 resolved')).toBeVisible();
  await page.getByLabel('Take all lines from B for this conflict').click();
  await expect(page.getByText('0 of 1 resolved')).toBeVisible();
  await page.getByTitle(/Unresolved conflict/).first().click();
  const editor = page.getByLabel('Hand-edited result for this conflict');
  await expect(editor).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(editor).toBeHidden();
  await expect(page.getByText('0 of 1 resolved')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mark resolved' })).toBeDisabled();
});

test('conflict result can be hand-edited per block', async ({ page }) => {
  await page.goto('/');
  await page.getByText('angkorgit', { exact: true }).first().click();
  await expect(page.getByPlaceholder('Search commits…')).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: /drawGraph\.ts/ }).first().click();
  await expect(page.getByText('0 of 1 resolved')).toBeVisible();
  await page.getByTitle(/Unresolved conflict/).first().click();
  const editor = page.getByLabel('Hand-edited result for this conflict');
  await expect(editor).toBeVisible();
  await editor.fill('const palette = mergedThemePalette();');
  await expect(page.getByText('1 of 1 resolved')).toBeVisible();
  await page.getByText('Result', { exact: true }).click();
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
  await expect(page.getByText('1 of 1 resolved')).toBeVisible();
});

test('conflict picks land in file order and a half-picked side shows as mixed', async ({ page }) => {
  await page.goto('/');
  await page.getByText('angkorgit', { exact: true }).first().click();
  await expect(page.getByPlaceholder('Search commits…')).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: /drawGraph\.ts/ }).first().click();
  await expect(page.getByText('0 of 1 resolved')).toBeVisible();
  await page.getByText('return render(rows, { colors });').first().click();
  await page.getByText('const palette = useThemePalette();').first().click();
  await expect(page.getByText('1 of 1 resolved')).toBeVisible();
  await expect(page.getByText('resolved', { exact: true })).toBeVisible();
  const resultLines = page.locator('[data-line] pre');
  await expect(resultLines).toHaveCount(2);
  await expect(resultLines.nth(0)).toHaveText(/const palette = useThemePalette\(\);/);
  await expect(resultLines.nth(1)).toHaveText(/return render\(rows, \{ colors \}\);/);
  await expect(page.getByLabel('Take all lines from A for this conflict')).toHaveAttribute('aria-checked', 'mixed');
  await expect(page.getByLabel('Take all lines from B for this conflict')).toHaveAttribute('aria-checked', 'mixed');
  await page.getByLabel('Take all lines from A for this conflict').click();
  await expect(page.getByLabel('Take all lines from A for this conflict')).toHaveAttribute('aria-checked', 'true');
  await expect(resultLines).toHaveCount(3);
});

test('the resolver picks with the keyboard and opens the next conflicted file after saving', async ({ page }) => {
  await page.goto('/');
  await page.getByText('angkorgit', { exact: true }).first().click();
  await expect(page.getByPlaceholder('Search commits…')).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: /laneColors\.ts/ }).first().click();
  await expect(page.getByText('0 of 3 resolved')).toBeVisible();
  await expect(page.getByText('File 2 of 2')).toBeVisible();
  await page.keyboard.press('a');
  await expect(page.getByText('1 of 3 resolved')).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByText('Conflict 2 of 3')).toBeVisible();
  await page.keyboard.press('b');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('b');
  await expect(page.getByText('3 of 3 resolved')).toBeVisible();
  await expect(page.getByText('(section deleted)')).toBeVisible();
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(page.getByText('laneColors.ts resolved')).toBeVisible();
  await expect(page.getByText('1 more file to resolve')).toBeVisible();
  await expect(page.getByRole('dialog', { name: /Resolve conflicts in src\/features\/graph\/drawGraph\.ts/ })).toBeVisible();
  await expect(page.getByText('File 1 of 2')).toBeHidden();
});

test('leaving a conflict with picks asks first while a clean resolver closes on Escape', async ({ page }) => {
  await page.goto('/');
  await page.getByText('angkorgit', { exact: true }).first().click();
  await expect(page.getByPlaceholder('Search commits…')).toBeVisible({ timeout: 10_000 });
  const open = () => page.getByRole('button', { name: /drawGraph\.ts/ }).first().click();
  const resolver = page.getByRole('dialog', { name: /Resolve conflicts/ });
  await open();
  await expect(resolver).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(resolver).toBeHidden();
  await open();
  await page.getByLabel('Take all lines from A for this conflict').click();
  await page.keyboard.press('Escape');
  const confirm = page.getByRole('dialog').filter({ hasText: 'Leave this file unresolved?' });
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(confirm).toBeHidden();
  await expect(page.getByText('1 of 1 resolved')).toBeVisible();
  await resolver.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Leave' }).click();
  await expect(resolver).toBeHidden();
});

test('right-clicking a branch tip offers to push that branch', async ({ page }) => {
  await page.goto('/');
  await page.getByText('angkorgit', { exact: true }).first().click();
  await expect(page.getByPlaceholder('Search commits…')).toBeVisible({ timeout: 10_000 });
  await page.getByRole('row').nth(0).click({ button: 'right' });
  const pushItem = page.getByRole('menuitem', { name: /^Push main/ });
  await expect(pushItem).toBeVisible();
  await expect(pushItem).toContainText('↑2');
  await page.keyboard.press('Escape');
  await page.getByRole('row').nth(3).click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: /Cherry-pick onto current branch/ })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: /^Push/ })).toHaveCount(0);
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
  await expect(page.getByText('1 of 1')).toBeVisible();

  await page.getByText('fix(diff): handle renamed files in word diff').first().click();
  await expect(page.getByText('400 commits')).toBeVisible();
});

test('a short hash prefix jumps like a full hash and an unknown hex word reports no matches', async ({ page }) => {
  await page.goto('/');
  await page.getByText('angkorgit', { exact: true }).first().click();
  const search = page.getByPlaceholder('Search commits…');
  await expect(search).toBeVisible({ timeout: 10_000 });

  await search.fill('000096');
  await expect(page.getByText('400 commits')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('000096aa').first()).toBeVisible();

  await search.fill('dedede');
  await expect(page.getByText('No matches')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('400 commits')).toBeVisible();
});

test('searching a hash that does not exist keeps the graph and says so', async ({ page }) => {
  await page.goto('/');
  await page.getByText('angkorgit', { exact: true }).first().click();
  const search = page.getByPlaceholder('Search commits…');
  await expect(search).toBeVisible({ timeout: 10_000 });
  await search.fill('deadbeef123');
  await expect(page.getByText('No matches')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/200\+ commits/)).toBeVisible();
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

  const widthOf = async (locator: typeof sidebar) => (await locator.boundingBox())?.width ?? 0;
  await page.getByText('CommitGraph.tsx').first().click();
  await expect(page.locator('section[aria-label^="Diff for"]')).toBeVisible();
  await expect.poll(() => widthOf(sidebar)).toBeLessThan(2);
  await expect.poll(async () => Math.abs((await widthOf(inspector)) - inspectorBefore)).toBeLessThan(2);

  await page.keyboard.press('Escape');
  await expect(page.getByPlaceholder('Search commits…')).toBeVisible();
  await expect.poll(async () => Math.abs((await widthOf(sidebar)) - sidebarBefore)).toBeLessThan(2);
  await expect.poll(async () => Math.abs((await widthOf(inspector)) - inspectorBefore)).toBeLessThan(2);
});

test('the inspector stops at its minimum width when dragged and comes back after file history', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByText('angkorgit', { exact: true }).first().click();
  await expect(page.getByPlaceholder('Search commits…')).toBeVisible({ timeout: 10_000 });
  const inspector = page.locator('[data-panel-id="inspector"]');
  const widthOf = async () => (await inspector.boundingBox())?.width ?? 0;
  const handle = page.locator('[data-panel-resize-handle-id]').nth(1);
  const grip = await handle.boundingBox();
  if (!grip) throw new Error('no inspector resize handle');
  await page.mouse.move(grip.x + grip.width / 2, grip.y + 300);
  await page.mouse.down();
  await page.mouse.move(1430, grip.y + 300, { steps: 12 });
  await page.mouse.up();
  const minimum = await widthOf();
  expect(minimum).toBeGreaterThan(200);
  await expect(page.getByLabel('Inspector')).toBeVisible();
  await expect(page.getByText('ipc.ts', { exact: true }).first()).toBeVisible();

  await page.getByText('CommitGraph.tsx').first().click();
  await page.locator('section[aria-label^="Diff for"]').getByRole('button', { name: 'File history' }).click();
  await expect(page.locator('section[aria-label^="History of"]')).toBeVisible();
  await expect.poll(widthOf).toBeLessThan(2);
  await page.getByRole('button', { name: 'Close file history' }).click();
  await expect(page.getByPlaceholder('Search commits…')).toBeVisible();
  await expect.poll(async () => Math.abs((await widthOf()) - minimum)).toBeLessThan(2);
});

test('dragging the sidebar shut and back open shows its content again', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByText('angkorgit', { exact: true }).first().click();
  await expect(page.getByPlaceholder('Search commits…')).toBeVisible({ timeout: 10_000 });
  const sidebar = page.locator('[data-panel-id="sidebar"]');
  const filter = page.getByPlaceholder('Filter refs…');
  await expect(filter).toBeVisible();
  const handle = page.locator('[data-panel-resize-handle-id]').first();
  const grip = await handle.boundingBox();
  if (!grip) throw new Error('no sidebar resize handle');
  await page.mouse.move(grip.x + grip.width / 2, grip.y + 300);
  await page.mouse.down();
  await page.mouse.move(4, grip.y + 300, { steps: 12 });
  await expect(filter).toBeHidden();
  await expect.poll(async () => (await sidebar.boundingBox())?.width ?? 0).toBeLessThan(2);
  await page.mouse.move(grip.x + 40, grip.y + 300, { steps: 12 });
  await page.mouse.up();
  await expect(filter).toBeVisible();
  expect((await sidebar.boundingBox())?.width ?? 0).toBeGreaterThan(200);
  await expect(page.getByRole('button', { name: /^Branches/ })).toBeVisible();
});

test('commit box separates a summary line from a smaller description', async ({ page }) => {
  await page.goto('/');
  await page.getByText('angkorgit', { exact: true }).first().click();
  await expect(page.getByPlaceholder('Search commits…')).toBeVisible({ timeout: 10_000 });
  const summary = page.getByLabel('Commit summary');
  const description = page.getByLabel('Commit description');
  await summary.click();
  await summary.fill('feat(worktrees): list, create and remove linked worktrees');
  await expect(page.getByTitle('Summary length (50 recommended, 72 max)')).toHaveText('57/72');
  await summary.press('Enter');
  await expect(description).toBeFocused();
  await page.keyboard.type('Explains the why.');
  const [summarySize, descriptionSize] = await Promise.all([
    summary.evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
    description.evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
  ]);
  expect(summarySize).toBeGreaterThan(descriptionSize);
  await expect(summary).toHaveCSS('font-weight', '500');
  await expect(page.getByRole('button', { name: /^Commit \d+ files?$/ })).toBeEnabled();

  await summary.fill('');
  await expect(page.getByRole('button', { name: /^Commit \d+ files?$/ })).toBeDisabled();
  await description.click();
  await description.fill('');
  await description.press('Backspace');
  await expect(summary).toBeFocused();
});

test('the commit box grows when its top edge is dragged and resets on double-click', async ({ page }) => {
  await page.goto('/');
  await page.getByText('angkorgit', { exact: true }).first().click();
  await expect(page.getByPlaceholder('Search commits…')).toBeVisible({ timeout: 10_000 });
  const description = page.getByLabel('Commit description');
  const before = (await description.boundingBox())?.height ?? 0;
  const handle = page.getByRole('separator', { name: 'Resize commit box' });
  const grip = await handle.boundingBox();
  if (!grip) throw new Error('no resize handle');
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2, grip.y - 120, { steps: 6 });
  await page.mouse.up();
  const after = (await description.boundingBox())?.height ?? 0;
  expect(after - before).toBeGreaterThan(100);
  await handle.dblclick();
  const reset = (await description.boundingBox())?.height ?? 0;
  expect(Math.abs(reset - before)).toBeLessThan(2);
});

test('folder tree view can collapse and expand every folder at once', async ({ page }) => {
  await page.goto('/');
  await page.getByText('angkorgit', { exact: true }).first().click();
  await expect(page.getByPlaceholder('Search commits…')).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Folder tree' }).click();
  await expect(page.getByText('ipc.ts', { exact: true }).first()).toBeVisible();
  const changesHeader = page.locator('div', { has: page.getByText(/^Changes/) }).filter({ has: page.getByRole('button', { name: 'Stage all' }) }).last();
  await changesHeader.getByRole('button', { name: 'Collapse all folders' }).click();
  await expect(page.getByText('ipc.ts', { exact: true })).toBeHidden();
  await changesHeader.getByRole('button', { name: 'Expand all folders' }).click();
  await expect(page.getByText('ipc.ts', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Flat file list' }).click();
  await expect(page.getByRole('button', { name: /all folders$/ })).toHaveCount(0);
});

test('graph ref chips show whole labels and fold the rest behind a count', async ({ page }) => {
  await page.goto('/');
  await page.getByText('angkorgit', { exact: true }).first().click();
  await expect(page.getByPlaceholder('Search commits…')).toBeVisible({ timeout: 10_000 });
  const firstRow = page.getByRole('row').filter({ hasText: 'feat(graph): virtualize commit rows' }).first();
  await expect(firstRow.getByText('main', { exact: true })).toBeVisible();
  const chips = firstRow.locator('span.inline-flex');
  const labels = await chips.allInnerTexts();
  expect(labels.some((t) => t.trim() === 'main')).toBe(true);
  expect(labels.some((t) => t.trim() === 'HEAD')).toBe(false);
  for (const chip of await chips.all()) {
    const clipped = await chip.evaluate((el) => {
      const text = el.querySelector('span.truncate') ?? el;
      return text.scrollWidth > text.clientWidth + 1;
    });
    expect(clipped).toBe(false);
  }
  const hash = firstRow.getByTitle('Copy full hash');
  await expect(hash).toHaveText(/^[0-9a-f]{7}$/);
});

test('graph display menu can switch the lane color band off and on', async ({ page }) => {
  await page.goto('/');
  await page.getByText('angkorgit', { exact: true }).first().click();
  await expect(page.getByPlaceholder('Search commits…')).toBeVisible({ timeout: 10_000 });
  await expect.poll(() => page.locator('[data-graph-tail]').count()).toBeGreaterThan(5);
  await page.getByRole('button', { name: 'Graph display options' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Lane color band' }).click();
  await expect(page.locator('[data-graph-tail]')).toHaveCount(0);
  await page.getByRole('menuitemcheckbox', { name: 'Lane color band' }).click();
  await expect.poll(() => page.locator('[data-graph-tail]').count()).toBeGreaterThan(5);
});

test('graph display menu hides and restores the hash column', async ({ page }) => {
  await page.goto('/');
  await page.getByText('angkorgit', { exact: true }).first().click();
  await expect(page.getByPlaceholder('Search commits…')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTitle('Copy full hash').first()).toBeVisible();
  await page.getByRole('button', { name: 'Graph display options' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Hash' }).click();
  await expect(page.getByTitle('Copy full hash')).toHaveCount(0);
  await expect(page.getByRole('menuitemcheckbox', { name: 'Hash' })).toBeVisible();
  await page.getByRole('menuitemcheckbox', { name: 'Hash' }).click();
  await expect(page.getByTitle('Copy full hash').first()).toBeVisible();
});

test('sidebar sections behave as an accordion with collapsed headers pinned', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByText('angkorgit', { exact: true }).first().click();
  await expect(page.getByPlaceholder('Search commits…')).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Collapse all sections' }).click();
  await page.getByRole('button', { name: /^Branches/ }).click();
  const aside = page.getByRole('complementary', { name: 'Branches and refs' });
  const asideBox = await aside.boundingBox();
  const tagsBox = await page.getByRole('button', { name: /^Tags/ }).boundingBox();
  const stashesBox = await page.getByRole('button', { name: /^Stashes/ }).boundingBox();
  if (!asideBox || !tagsBox || !stashesBox) throw new Error('sidebar geometry missing');
  expect(stashesBox.y + stashesBox.height).toBeGreaterThan(asideBox.y + asideBox.height - 90);
  expect(tagsBox.y).toBeLessThan(stashesBox.y);
  const developBox = await page.getByText('develop', { exact: true }).boundingBox();
  if (!developBox) throw new Error('branch row missing');
  expect(developBox.y).toBeLessThan(tagsBox.y);
  await page.getByRole('button', { name: /^Tags/ }).click();
  await expect(aside.getByText('v0.4.0', { exact: true })).toBeVisible();
  const tagsAfter = await page.getByRole('button', { name: /^Tags/ }).boundingBox();
  if (!tagsAfter) throw new Error('tags header missing');
  expect(tagsAfter.y).toBeLessThan(tagsBox.y);
});

test('welcome page flags missing folders and opens a repository from the keyboard', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Recent repositories')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('folder missing')).toBeVisible();
  await expect(page.getByText('~/work/api-gateway')).toBeVisible();
  const search = page.getByLabel('Search recent repositories');
  await expect(search).toBeFocused();
  await search.press('ArrowDown');
  await search.press('Enter');
  await expect(page.getByPlaceholder('Search commits…')).toBeVisible({ timeout: 10_000 });
});

test('conflict resolver shows line numbers in both sides and the result', async ({ page }) => {
  await page.goto('/');
  await page.getByText('angkorgit', { exact: true }).first().click();
  await expect(page.getByPlaceholder('Search commits…')).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: /drawGraph\.ts/ }).first().click();
  const dialog = page.getByRole('dialog', { name: /Resolve conflicts/ });
  await expect(dialog).toBeVisible();
  const gutters = dialog.locator('span[data-line-no]');
  const values = (await gutters.allInnerTexts()).map((t) => t.trim()).filter(Boolean).map(Number);
  expect(values.length).toBeGreaterThan(6);
  expect(values.filter((n) => n === 1).length).toBeGreaterThanOrEqual(3);
  expect(values.every((n) => Number.isInteger(n) && n > 0)).toBe(true);
});

test('the checked-out branch chip is filled while other local chips stay tinted', async ({ page }) => {
  await page.goto('/');
  await page.getByText('angkorgit', { exact: true }).first().click();
  await expect(page.getByPlaceholder('Search commits…')).toBeVisible({ timeout: 10_000 });
  const headChip = page.getByTitle(/^main · local/).first();
  const otherChip = page.getByTitle(/^feature\/diff-viewer · local/).first();
  const opacity = (color: string) => Number(color.split(',')[3]?.replace(')', '') ?? '1');
  const headBg = await headChip.evaluate((el) => getComputedStyle(el).backgroundColor);
  const otherBg = await otherChip.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(headBg).not.toBe(otherBg);
  expect(opacity(headBg)).toBe(1);
  expect(opacity(otherBg)).toBeLessThan(1);
});

test('double-clicking a separated origin chip offers to reset the local branch', async ({ page }) => {
  await page.goto('/');
  await page.getByText('angkorgit', { exact: true }).first().click();
  await expect(page.getByPlaceholder('Search commits…')).toBeVisible({ timeout: 10_000 });
  await page.getByTitle(/origin\/main — double-click to reset main to it/).first().dblclick();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Reset branch to its remote?')).toBeVisible();
  await expect(dialog.getByText(/2 commits only on the local branch will be lost/)).toBeVisible();
  await expect(dialog.getByText(/Hard reset to origin\/main/)).toBeVisible();
  const box = await dialog.boundingBox();
  const button = await dialog.getByRole('button', { name: 'Reset branch' }).boundingBox();
  if (!box || !button) throw new Error('dialog geometry missing');
  expect(button.x + button.width).toBeLessThanOrEqual(box.x + box.width + 1);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
});

test('the diff header opens the history of the file being viewed', async ({ page }) => {
  await page.goto('/');
  await page.getByText('angkorgit', { exact: true }).first().click();
  await expect(page.getByPlaceholder('Search commits…')).toBeVisible({ timeout: 10_000 });
  await page.getByText('CommitGraph.tsx').first().click();
  const diff = page.locator('section[aria-label^="Diff for"]');
  await expect(diff).toBeVisible();
  await diff.getByRole('button', { name: 'File history' }).click();
  await expect(page.locator('section[aria-label^="History of"]')).toBeVisible();
  await expect(page.getByLabel('History of src/features/graph/CommitGraph.tsx')).toBeVisible();
  await expect(diff).toBeHidden();
});

test('a single file can be stashed from its row menu and the toolbar pops the latest stash', async ({ page }) => {
  await page.goto('/');
  await page.getByText('angkorgit', { exact: true }).first().click();
  await expect(page.getByPlaceholder('Search commits…')).toBeVisible({ timeout: 10_000 });

  await page.getByText('ipc.ts', { exact: true }).first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: /Stash this file/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Stash selected changes')).toBeVisible();
  await expect(dialog.getByText('ipc.ts', { exact: true })).toBeVisible();
  await expect(dialog.getByText('src/core', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  const pop = page.getByRole('button', { name: 'Pop latest stash' });
  await expect(pop).toBeEnabled();
  await pop.hover();
  await expect(page.getByRole('tooltip').filter({ hasText: 'WIP on main: experiment with lane colors' })).toBeVisible();
  await pop.click();
  await expect(page.getByText('Pop stash complete')).toBeVisible();
});

test('shift-click selects a range of working copy files and the menu acts on all of them', async ({ page }) => {
  await page.goto('/');
  await page.getByText('angkorgit', { exact: true }).first().click();
  await expect(page.getByPlaceholder('Search commits…')).toBeVisible({ timeout: 10_000 });

  await page.getByText('ipc.ts', { exact: true }).first().click();
  await page.getByText('Architecture.md', { exact: true }).first().click({ modifiers: ['Shift'] });
  await expect(page.locator('[data-selected-file-row]')).toHaveCount(3);

  await page.getByText('palette-seed.sql', { exact: true }).first().click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Stage 3 files' })).toBeVisible();
  await page.getByRole('menuitem', { name: /Stash 3 files/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Stash selected changes')).toBeVisible();
  await expect(dialog.getByText('ipc.ts', { exact: true })).toBeVisible();
  await expect(dialog.getByText('palette-seed.sql', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Architecture.md', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');

  await page.getByText('ipc.ts', { exact: true }).first().click();
  await expect(page.locator('[data-selected-file-row]')).toHaveCount(1);
});

test('the working copy filter narrows both lists and shows counts', async ({ page }) => {
  await page.goto('/');
  await page.getByText('angkorgit', { exact: true }).first().click();
  await expect(page.getByPlaceholder('Search commits…')).toBeVisible({ timeout: 10_000 });

  await expect(page.getByPlaceholder('Filter changed files…')).toHaveCount(0);
  await page.getByRole('button', { name: 'Filter files' }).click();
  const filter = page.getByPlaceholder('Filter changed files…');
  await expect(filter).toBeFocused();
  await filter.fill('graph');
  await expect(page.getByText('CommitGraph.tsx', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('ipc.ts', { exact: true })).toHaveCount(0);
  await expect(page.getByText('No changes match the filter.')).toBeVisible();
  await expect(page.getByText(/^Staged/).locator('..')).toContainText('1 of 2');

  await page.getByRole('button', { name: 'Clear filter' }).click();
  await expect(filter).toHaveValue('');
  await expect(page.getByText('ipc.ts', { exact: true }).first()).toBeVisible();
  await page.getByRole('row').first().click();
  await expect(filter).toHaveCount(0);
  await page.getByRole('button', { name: 'Back to working copy' }).click();
  await expect(page.getByPlaceholder('Filter changed files…')).toBeVisible();
  await expect(page.getByPlaceholder('Filter changed files…')).not.toBeFocused();
  await page.getByPlaceholder('Filter changed files…').press('Escape');
  await expect(page.getByPlaceholder('Filter changed files…')).toHaveCount(0);
});

test('the commit file list can be filtered by path', async ({ page }) => {
  await page.goto('/');
  await page.getByText('angkorgit', { exact: true }).first().click();
  await expect(page.getByPlaceholder('Search commits…')).toBeVisible({ timeout: 10_000 });
  await page.getByText('feat(graph): virtualize commit rows').first().click();

  const inspector = page.getByRole('complementary', { name: 'Inspector' });
  await expect(inspector.getByText('GraphRow.tsx', { exact: true })).toBeVisible();
  await inspector.getByRole('button', { name: 'Filter files' }).click();
  const filter = inspector.getByPlaceholder('Filter files…');
  await filter.fill('docs');
  await expect(inspector.getByText('Architecture.md', { exact: true })).toBeVisible();
  await expect(inspector.getByText('GraphRow.tsx', { exact: true })).toHaveCount(0);
  await expect(inspector.getByText('1 of 5')).toBeVisible();

  await filter.press('Escape');
  await expect(filter).toHaveValue('');
  await expect(inspector.getByText('GraphRow.tsx', { exact: true })).toBeVisible();
  await inspector.getByRole('button', { name: 'Hide file filter' }).click();
  await expect(inspector.getByPlaceholder('Filter files…')).toHaveCount(0);
});

test('a stash lists its files and one file can be restored on its own', async ({ page }) => {
  await page.goto('/');
  await page.getByText('angkorgit', { exact: true }).first().click();
  await expect(page.getByPlaceholder('Search commits…')).toBeVisible({ timeout: 10_000 });

  await expect(page.getByText('feat(graph): virtualize commit rows').first()).toBeVisible();
  await page.getByText('WIP on main: experiment with lane colors').first().click();
  const inspector = page.getByRole('complementary', { name: 'Inspector' });
  await expect(inspector.getByText('This is a stash.', { exact: false })).toBeVisible();
  const restore = inspector.getByRole('button', { name: 'Apply src/features/graph/GraphRow.tsx from the stash' });
  await inspector.getByText('GraphRow.tsx', { exact: true }).hover();
  await restore.click();
  await expect(page.getByText('Applied GraphRow.tsx from the stash')).toBeVisible();

  await inspector.getByRole('checkbox', { name: 'Select src/features/graph/CommitGraph.tsx to apply' }).click();
  await inspector.getByText('Architecture.md', { exact: true }).click({ modifiers: ['Shift'] });
  await expect(inspector.getByText('4 of 5 selected')).toBeVisible();
  await inspector.getByRole('button', { name: 'Apply 4 files' }).click();
  await expect(page.getByText('Applied 4 files from the stash')).toBeVisible();
  await expect(inspector.getByText('This is a stash.', { exact: false })).toBeVisible();
});

test('staged files can be discarded from the row, the menu and the header', async ({ page }) => {
  await page.goto('/');
  await page.getByText('angkorgit', { exact: true }).first().click();
  await expect(page.getByPlaceholder('Search commits…')).toBeVisible({ timeout: 10_000 });

  const stagedDiscard = page.getByRole('button', { name: 'Discard src/features/graph/CommitGraph.tsx' });
  await page.getByText('CommitGraph.tsx', { exact: true }).first().hover();
  await stagedDiscard.click({ force: true });
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Discard changes?')).toBeVisible();
  await expect(dialog.getByText(/back to the last commit/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();

  await page.getByText('CommitGraph.tsx', { exact: true }).first().click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: /Discard changes/ })).toBeVisible();
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Discard all staged changes' }).click();
  await expect(dialog.getByText('Discard all 2 staged changes?')).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
});

test('the sidebar comes back after a relaunch that happened with a diff open', async ({ page }) => {
  await page.goto('/');
  await page.getByText('angkorgit', { exact: true }).first().click();
  await expect(page.getByPlaceholder('Search commits…')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('complementary', { name: 'Branches and refs' })).toBeVisible();
  await page.getByText('ipc.ts', { exact: true }).first().click();
  await expect(page.locator('section[aria-label^="Diff for"]')).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Branches and refs' })).toBeHidden();
  await page.waitForTimeout(300);

  await page.reload();
  await page.getByText('angkorgit', { exact: true }).first().click();
  await expect(page.getByPlaceholder('Search commits…')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('complementary', { name: 'Branches and refs' })).toBeVisible();
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('angkorgit-ui') ?? '{}'));
  expect(stored.state?.sidebarOpen).toBe(true);
});

test('a stash shows up in the graph with its own node and a menu to pop it', async ({ page }) => {
  await page.goto('/');
  await page.getByText('angkorgit', { exact: true }).first().click();
  await expect(page.getByPlaceholder('Search commits…')).toBeVisible({ timeout: 10_000 });
  const chip = page.getByRole('table', { name: 'Commits' }).getByTitle(/^WIP on main: experiment with lane colors/);
  await expect(chip).toBeVisible();
  const row = chip.locator('xpath=ancestor::*[@role="row"]');
  await expect(row.getByRole('img', { name: 'Stash' })).toBeVisible();
  await row.click({ button: 'right', position: { x: 400, y: 10 } });
  await expect(page.getByRole('menuitem', { name: 'Apply stash (keep it)' })).toBeVisible();
  await page.keyboard.press('Escape');
  await chip.click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Apply stash (keep it)' })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Pop stash' }).click();
  await expect(page.getByText('Pop stash done')).toBeVisible();
});

test('arrow keys walk from the graph into a commit\u2019s files and back', async ({ page }) => {
  await page.goto('/');
  await page.getByText('angkorgit', { exact: true }).first().click();
  await expect(page.getByPlaceholder('Search commits…')).toBeVisible({ timeout: 10_000 });
  const rows = page.getByRole('row');
  await rows.first().click();
  await expect(rows.first()).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowDown');
  await expect(rows.nth(1)).toHaveAttribute('aria-selected', 'true');
  const secondHash = (await rows.nth(1).locator('button.font-mono').innerText()).trim();
  await expect(page.getByRole('complementary', { name: 'Inspector' }).getByText(secondHash.slice(0, 7))).toBeVisible();

  await page.keyboard.press('ArrowRight');
  const files = page.getByLabel('Commit files');
  await expect(files).toBeFocused();
  await expect(page.locator('section[aria-label="Diff for src/features/graph/CommitGraph.tsx"]')).toBeVisible();

  await page.keyboard.press('ArrowDown');
  await expect(page.locator('section[aria-label="Diff for src/features/graph/GraphRow.tsx"]')).toBeVisible();
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('section[aria-label="Diff for src/features/graph/CommitGraph.tsx"]')).toBeVisible();

  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('section[aria-label^="Diff for"]')).toHaveCount(0);
  await expect(rows.nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(rows.nth(1).locator('button.font-mono')).toHaveText(secondHash);
  await page.keyboard.press('ArrowDown');
  await expect(rows.nth(2)).toHaveAttribute('aria-selected', 'true');
});

test('settings can install the command line tool', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Recent repositories')).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Git', exact: true }).click();
  await expect(dialog.getByText('Command line tool')).toBeVisible();
  await expect(dialog.getByText('angkorgit open [path]')).toBeVisible();
  await expect(dialog.getByText(/angkorgit clone \[-b branch\]/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Install', exact: true }).click();
  await expect(dialog.getByText('/usr/local/bin/angkorgit')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Uninstall', exact: true })).toBeVisible();
});
