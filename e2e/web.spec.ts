import { expect, test } from '@playwright/test';

const API = 'http://127.0.0.1:7391';
const URL = `${API}/?api=${encodeURIComponent(API)}`;

test('loads the UI and connects to the local node (no "Failed to fetch")', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  await page.goto(URL);
  await expect(page.locator('.brand')).toContainText('PeerForum');
  // The identity block only renders after /status succeeds.
  await expect(page.locator('.identity')).toBeVisible();
  await expect(page.locator('.banner.error')).toHaveCount(0);
  expect(consoleErrors.join('\n')).not.toContain('Failed to fetch');
});

test('creates a network, generates a copyable invite and shows a QR', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(URL);

  await page.getByRole('button', { name: /Networks/ }).click();
  await page.getByPlaceholder('Network name').fill('E2E Net');
  await page.getByRole('button', { name: 'Create' }).click();

  await expect(page.getByRole('heading', { name: /E2E Net/ })).toBeVisible();

  await page.getByRole('button', { name: 'Generate code' }).click();
  const codeArea = page.locator('.invite textarea');
  await expect(codeArea).toHaveValue(/PFPJOIN1\./);
  await expect(page.locator('.invite img')).toBeVisible();

  await page.getByRole('button', { name: 'Copiar código' }).click();
  await expect(page.getByRole('button', { name: 'Copiado!' })).toBeVisible();

  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboard).toMatch(/^PFPJOIN1\./);
});

test('posts a topic and a reply', async ({ page }) => {
  await page.goto(URL);

  const topicText = `E2E topic ${Date.now()}\nbody line`;
  await page.getByPlaceholder(/First line is the title/).fill(topicText);
  await page.getByRole('button', { name: /Publish/ }).click();

  await expect(page.getByRole('heading', { name: /E2E topic/ })).toBeVisible();

  await page.getByPlaceholder(/Write a reply/).fill('E2E reply');
  await page.getByRole('button', { name: 'Reply' }).click();
  await expect(page.getByText('E2E reply')).toBeVisible();
});
