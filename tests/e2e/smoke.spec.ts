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
