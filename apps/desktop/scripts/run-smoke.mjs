import { spawnSync } from 'node:child_process';

import electronPath from 'electron';

// Run the bundled smoke test under Electron's bundled Node (same runtime as the
// real app), with `ELECTRON_RUN_AS_NODE` so no window/display is required.
const result = spawnSync(electronPath, ['dist/smoke.mjs'], {
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
});

process.exit(result.status ?? 1);
