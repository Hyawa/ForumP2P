/**
 * Copies the bundled Node.js project (`apps/mobile/nodejs/dist`) into the
 * Capacitor `webDir` at `nodejs/`, where `@capawesome/capacitor-nodejs` expects
 * it (`nodeDir: 'nodejs'`). Must run after the web build (which cleans webDir)
 * and before `cap sync`.
 */
import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const src = fileURLToPath(new URL('../nodejs/dist/', import.meta.url));
const dest = fileURLToPath(new URL('../../../packages/web/dist/nodejs/', import.meta.url));

await rm(dest, { recursive: true, force: true });
await mkdir(dest, { recursive: true });
await cp(src, dest, { recursive: true });

console.log(`mobile: copied node project into ${dest}`);
