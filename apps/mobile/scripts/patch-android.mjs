/**
 * Patches the generated Android manifest after `cap sync`.
 *
 * `apps/mobile/android/` is git-ignored (regenerable), so instead of editing the
 * manifest by hand we re-apply the required bits here, idempotently:
 *   - `android:usesCleartextTraffic="true"` — the local daemon is plain HTTP on
 *     127.0.0.1 (Android blocks cleartext since targetSdk 28).
 *   - `CAMERA` permission — used by the QR invite scanner.
 *
 * Safe to run when the platform does not exist yet (it just no-ops).
 */
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const manifestPath = fileURLToPath(
  new URL('../android/app/src/main/AndroidManifest.xml', import.meta.url),
);

if (!existsSync(manifestPath)) {
  console.log('mobile: android platform not found, skipping manifest patch');
  process.exit(0);
}

let manifest = await readFile(manifestPath, 'utf8');
const before = manifest;

if (!manifest.includes('usesCleartextTraffic')) {
  manifest = manifest.replace(
    /<application\b/,
    '<application\n        android:usesCleartextTraffic="true"',
  );
}

if (!manifest.includes('android.permission.CAMERA')) {
  manifest = manifest.replace(
    /<\/manifest>/,
    '    <uses-permission android:name="android.permission.CAMERA" />\n</manifest>',
  );
}

if (manifest !== before) {
  await writeFile(manifestPath, manifest);
  console.log('mobile: patched AndroidManifest.xml (cleartext + camera)');
} else {
  console.log('mobile: AndroidManifest.xml already patched');
}
