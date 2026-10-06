/**
 * Bundles the mobile Node.js project (`apps/mobile/nodejs`) into a single ESM
 * file for `@capawesome/capacitor-nodejs`.
 *
 * - Everything (libp2p, our packages, Fastify) is bundled except Node built-ins,
 *   `node-sqlite3-wasm` (needs its `.wasm` beside it) and the plugin's `bridge`.
 * - A banner installs the `Promise.withResolvers` polyfill before any module.
 * - The `node-sqlite3-wasm` package is copied next to the bundle so its
 *   `__dirname`-relative `.wasm` lookup works.
 *
 * The output is written to `apps/mobile/nodejs/dist/`, which the mobile `sync`
 * script copies into the Capacitor `webDir` under `nodejs/`.
 */
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const distDir = fileURLToPath(new URL('../nodejs/dist/', import.meta.url));
const entry = fileURLToPath(new URL('../nodejs/index.ts', import.meta.url));
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

const banner = {
  js: [
    "import { createRequire as __pfCreateRequire } from 'node:module';",
    'const require = __pfCreateRequire(import.meta.url);',
    "if(typeof Promise.withResolvers!=='function'){Promise.withResolvers=function(){let r,j;const p=new Promise((a,b)=>{r=a;j=b});return{promise:p,resolve:r,reject:j}};}",
  ].join('\n'),
};

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });

await build({
  entryPoints: [entry],
  outfile: join(distDir, 'index.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  logLevel: 'info',
  external: ['node:*', 'node-sqlite3-wasm', 'bridge'],
  banner,
});

await writeFile(
  join(distDir, 'package.json'),
  `${JSON.stringify(
    { name: 'pforum-mobile-node', version: '2.0.0', private: true, type: 'module', main: 'index.js' },
    null,
    2,
  )}\n`,
);

await cp(
  join(repoRoot, 'node_modules', 'node-sqlite3-wasm'),
  join(distDir, 'node_modules', 'node-sqlite3-wasm'),
  { recursive: true },
);

console.log(`mobile node: built ${distDir}`);
