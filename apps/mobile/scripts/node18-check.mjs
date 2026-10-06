/**
 * Node 18 compatibility check for the mobile node bundle.
 *
 * The mobile runtime is Node.js for Mobile Apps 18.20.x, but libp2p v3/Fastify 5
 * target Node 22+. This runs the *actual bundled* node project under Node 18
 * (via the `node@18` npm package) with the self-test enabled, so a missing
 * polyfill or a Node 22-only API fails here instead of on the device.
 *
 * Usage: node scripts/node18-check.mjs
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const bundle = fileURLToPath(new URL('../nodejs/dist/index.js', import.meta.url));

if (!existsSync(bundle)) {
  console.log('mobile node bundle missing; building…');
  const build = spawnSync('node', ['scripts/build-node.mjs'], {
    cwd: fileURLToPath(new URL('../', import.meta.url)),
    stdio: 'inherit',
  });
  if (build.status !== 0) process.exit(build.status ?? 1);
}

const dbDir = mkdtempSync(join(tmpdir(), 'pf-node18-'));
const port = 7300 + Math.floor(Math.random() * 500);

// Quote the bundle path: with `shell: true` (needed to run npx on Windows) the
// command is a single string, and the repo path contains spaces.
const command = `npx -y node@18.20.8 "${bundle}"`;
const result = spawnSync(command, {
  stdio: 'inherit',
  shell: true,
  env: {
    ...process.env,
    PFORUM_SELFTEST: '1',
    PFORUM_DB_DIR: dbDir,
    PFORUM_API_PORT: String(port),
  },
});

process.exit(result.status ?? 1);
