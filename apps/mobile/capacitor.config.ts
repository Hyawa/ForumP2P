import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor shell around the same React web UI used by the desktop app.
 *
 * `webDir` points at the Vite build output, so `npm run sync` copies the UI into
 * the native projects. See README.md in this folder for how a device reaches a
 * node (and the roadmap for an on-device node).
 */
const config: CapacitorConfig = {
  appId: 'org.pforum.app',
  appName: 'PeerForum',
  webDir: '../../packages/web/dist',
  android: {
    // The daemon currently speaks plain HTTP on the local network / Tor proxy.
    allowMixedContent: true,
  },
};

export default config;
