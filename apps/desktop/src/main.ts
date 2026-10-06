/**
 * PeerForum desktop shell (Electron).
 *
 * The main process IS the node: it starts a full `PFPNode` (libp2p + SQLite)
 * and the local daemon API, then loads the web UI in a BrowserWindow. This is
 * the "your machine is the server" model — no backend is involved.
 *
 * Anonymous (Tor) mode is enabled with environment variables, so a packaged app
 * can be launched as a Tor-only node:
 *
 *   PFORUM_TOR=1 PFORUM_ONION_DIR=/path/to/hs PFORUM_ONION_PORT=80
 *   PFORUM_TOR_SOCKS=127.0.0.1:9050 PFORUM_DB=... peerforum
 */
import { app, BrowserWindow, dialog, shell } from 'electron';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PFPNodeController, startDaemon, type TorConfig } from '@pforum/node';

const __dirname = dirname(fileURLToPath(import.meta.url));
const isDev = process.argv.includes('--dev');

type Daemon = Awaited<ReturnType<typeof startDaemon>>;

let active: { controller: PFPNodeController; server: Daemon } | null = null;
let quitting = false;

function envFlag(name: string): boolean {
  const value = process.env[name];
  return value === '1' || value?.toLowerCase() === 'true';
}

function torFromEnv(): TorConfig | null {
  if (!envFlag('PFORUM_TOR')) return null;
  const [host, port] = (process.env.PFORUM_TOR_SOCKS ?? '127.0.0.1:9050').split(':');
  const announce: string[] = [];
  if (process.env.PFORUM_ONION) announce.push(process.env.PFORUM_ONION);
  if (process.env.PFORUM_ONION_DIR) {
    const onion = readFileSync(join(process.env.PFORUM_ONION_DIR, 'hostname'), 'utf8').trim();
    announce.push(`/onion3/${onion}/tcp/${process.env.PFORUM_ONION_PORT ?? '80'}`);
  }
  if (announce.length === 0) {
    throw new Error('PFORUM_TOR is set but neither PFORUM_ONION nor PFORUM_ONION_DIR was provided');
  }
  return {
    socksHost: host || '127.0.0.1',
    socksPort: Number(port ?? '9050'),
    announce,
  };
}

async function startNode(): Promise<{ controller: PFPNodeController; server: Daemon; apiUrl: string }> {
  const tor = torFromEnv();
  const dbPath = process.env.PFORUM_DB ?? join(app.getPath('userData'), 'peerforum.db');

  const controller = await PFPNodeController.create({
    dbPath,
    listen: tor ? ['/ip4/127.0.0.1/tcp/4001'] : undefined,
    enableMdns: tor ? false : true,
    tor,
    autoSync: !envFlag('PFORUM_NO_SYNC'),
  });

  const server = await startDaemon(controller, {
    host: '127.0.0.1',
    port: 0,
    token: process.env.PFORUM_TOKEN,
    // Serve the bundled UI over HTTP so it loads same-origin (file:// blocks ESM).
    staticDir: isDev ? undefined : webDir(),
  });
  const address = server.server.address() as AddressInfo;
  return { controller, server, apiUrl: `http://127.0.0.1:${address.port}` };
}

/** Directory containing the built web UI (index.html + assets). */
function webDir(): string {
  if (app.isPackaged) return join(process.resourcesPath, 'web');
  // dist/main.mjs -> apps/desktop/dist -> repo root -> packages/web/dist
  return join(__dirname, '..', '..', '..', 'packages', 'web', 'dist');
}

async function createWindow(apiUrl: string): Promise<void> {
  const win = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0f1115',
    title: 'PeerForum',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      additionalArguments: [`--pf-api=${apiUrl}`],
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  if (isDev) {
    await win.loadURL(process.env.PFORUM_DEV_URL ?? 'http://localhost:5173');
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    // The node's daemon also serves the UI, so this is same-origin with `/status`.
    await win.loadURL(apiUrl);
  }
}

async function bootstrap(): Promise<void> {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }

  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  await app.whenReady();
  const started = await startNode();
  active = { controller: started.controller, server: started.server };

  await createWindow(started.apiUrl);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && active) {
      void createWindow(started.apiUrl);
    }
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', (event) => {
  if (quitting || !active) return;
  event.preventDefault();
  quitting = true;
  const { server, controller } = active;
  active = null;
  Promise.resolve(server.close())
    .catch(() => undefined)
    .then(() => controller.stop())
    .catch(() => undefined)
    .finally(() => app.quit());
});

bootstrap().catch((error: unknown) => {
  dialog.showErrorBox('PeerForum failed to start', String(error));
  app.quit();
});
