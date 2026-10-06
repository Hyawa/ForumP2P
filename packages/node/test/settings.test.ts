import { mkdtempSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { PFPNodeController } from '../src/controller';
import { startDaemon } from '../src/daemon';

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((fn) => fn()));
});

async function makeController() {
  const dir = mkdtempSync(join(tmpdir(), 'pf-settings-'));
  const dbPath = join(dir, 'peerforum.db');
  const controller = await PFPNodeController.create({
    dbPath,
    listen: ['/ip4/127.0.0.1/tcp/0'],
    enableMdns: false,
    autoSync: false,
  });
  const app = await startDaemon(controller, { host: '127.0.0.1', port: 0 });
  const { port } = app.server.address() as AddressInfo;
  cleanups.push(async () => {
    await app.close();
    await controller.stop();
  });
  return { controller, base: `http://127.0.0.1:${port}`, dbPath };
}

describe('settings API', () => {
  it('toggles Tor mode and rebuilds the node, persisting the setting', async () => {
    const { controller, base, dbPath } = await makeController();

    const initial = (await (await fetch(`${base}/settings`)).json()) as {
      tor: { enabled: boolean };
    };
    expect(initial.tor.enabled).toBe(false);
    expect(controller.current.anonymous).toBe(false);

    const put = await fetch(`${base}/settings`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tor: {
          enabled: true,
          socksHost: '127.0.0.1',
          socksPort: 9050,
          onion: 'a'.repeat(56),
          onionPort: 80,
        },
      }),
    });
    expect(put.status).toBe(200);
    const body = (await put.json()) as { status: { anonymous: boolean } };
    expect(body.status.anonymous).toBe(true);
    expect(controller.current.anonymous).toBe(true);

    // A fresh controller on the same DB must load the persisted setting.
    const reloaded = await PFPNodeController.create({ dbPath });
    cleanups.push(async () => reloaded.stop());
    expect(reloaded.getSettings().tor.enabled).toBe(true);
    expect(reloaded.current.anonymous).toBe(true);
  });

  it('rejects malformed settings', async () => {
    const { base } = await makeController();
    const response = await fetch(`${base}/settings`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tor: { enabled: 'yes' } }),
    });
    expect(response.status).toBe(400);
  });
});
