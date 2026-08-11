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
  await expect(page.getByText('Unresolved', { exact: true })).toBeVisible();
  await expect(page.getByText('<<<<<<<')).toHaveCount(0);
  await page.getByLabel('Take all lines from side A').click();
  await expect(page.getByText('1/1 resolved')).toBeVisible();
  await expect(page.getByText('const palette = useThemePalette();')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Mark resolved' })).toBeEnabled();
});
