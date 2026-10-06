import { _electron as electron, expect, test } from '@playwright/test';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const main = fileURLToPath(new URL('../apps/desktop/dist/main.mjs', import.meta.url));

test('desktop app boots, serves its UI and connects to its own node', async () => {
  test.skip(!existsSync(main), 'run "npm -w @pforum/desktop run build:main" first');

  const app = await electron.launch({
    args: [main],
    env: { ...process.env, PFORUM_NO_SYNC: '1', PFORUM_DB: ':memory:' },
  });
  try {
    const window = await app.firstWindow();
    await expect(window.locator('.brand')).toContainText('PeerForum');
    // The identity block only renders after the app's own daemon responds.
    await expect(window.locator('.identity')).toBeVisible();
    await expect(window.locator('.banner.error')).toHaveCount(0);
  } finally {
    await app.close();
  }
});
