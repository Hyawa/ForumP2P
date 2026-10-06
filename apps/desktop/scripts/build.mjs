import { rm } from 'node:fs/promises';

import { build } from 'esbuild';

await rm('dist', { recursive: true, force: true });

/**
 * Bundle the Electron main + preload into self-contained files so the packaged
 * app does not need the (large) P2P dependency tree at runtime. Only `electron`
 * and Node built-ins stay external — `node:sqlite` is provided by the runtime.
 */
const shared = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  sourcemap: true,
  logLevel: 'info',
  external: ['electron', 'node:*'],
};

// Some bundled CJS dependencies call `require()` dynamically. In ESM output
// esbuild's shim delegates to a real `require` when one is in scope, so provide
// one via createRequire.
const esmBanner = {
  js: "import { createRequire as __pfCreateRequire } from 'node:module'; const require = __pfCreateRequire(import.meta.url);",
};

await build({
  ...shared,
  entryPoints: ['src/main.ts'],
  outfile: 'dist/main.mjs',
  format: 'esm',
  banner: esmBanner,
});

await build({
  ...shared,
  entryPoints: ['src/preload.ts'],
  outfile: 'dist/preload.cjs',
  format: 'cjs',
});

if (process.argv.includes('--smoke')) {
  await build({
    ...shared,
    entryPoints: ['scripts/smoke.ts'],
    outfile: 'dist/smoke.mjs',
    format: 'esm',
    banner: esmBanner,
  });
}

console.log('desktop: built dist/main.mjs and dist/preload.cjs');
