import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor shell around the React web UI.
 *
 * The app runs a **full PFP node on-device** via `@capawesome/capacitor-nodejs`
 * (Node.js for Mobile Apps). The node project lives in `webDir/nodejs` and boots
 * the local daemon API on `http://127.0.0.1:7331`, which the WebView talks to.
 *
 * `cleartext`/`allowMixedContent` are required because the daemon is plain HTTP
 * on loopback (Android blocks cleartext by default since targetSdk 28).
 */
const config: CapacitorConfig = {
  appId: 'org.pforum.app',
  appName: 'PeerForum',
  webDir: '../../packages/web/dist',
  // Use the http scheme so the WebView origin is http://localhost and requests
  // to the local daemon are not treated as mixed content.
  server: {
    androidScheme: 'http',
    cleartext: true,
  },
  android: {
    allowMixedContent: true,
  },
  plugins: {
    Nodejs: {
      nodeDir: 'nodejs',
      startMode: 'auto',
    },
  },
};

export default config;
