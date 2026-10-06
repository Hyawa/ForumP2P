# PeerForum mobile (Capacitor)

Native Android/iOS shell around the same React UI used by the desktop app and
the browser. It is built with [Capacitor](https://capacitorjs.com/) and runs a
**full P2P node on-device**.

## How it works

The app embeds a Node.js runtime via
[`@capawesome/capacitor-nodejs`](https://capawesome.io/docs/sdks/capacitor/nodejs/)
(Node.js for Mobile Apps, **Node 18.20.x**). That runtime boots a real
`PFPNode` + the local daemon API on `http://127.0.0.1:7331`, and the WebView
talks to it over HTTP — so the phone is a genuine peer, not a thin client.

- **Node bundle:** `nodejs/index.ts` (entry) + `nodejs/polyfill.ts` (shims for
  `Promise.withResolvers`, `crypto`, `CustomEvent`, `navigator`, which are Node
  19+/22+ globals that libp2p/Fastify need).
- **Storage:** the built-in `node:sqlite` does not exist on Node 18, so the node
  uses the portable **`node-sqlite3-wasm`** driver (`dbDriver: 'wasm'`). The DB
  lives in the app's persistent data directory (`app.datadir()`).
- **Build:** `scripts/build-node.mjs` bundles everything (except Node built-ins,
  `node-sqlite3-wasm` and the plugin's `bridge`) into a single ESM file and
  copies the WASM SQLite package next to it.

## Build & run

```bash
# from apps/mobile
npm run add:android        # one-time: create the android/ project
npm run sync               # build web UI + node bundle + copy into native + patch manifest
npm run open:android       # open in Android Studio (optional)
npm run build:android      # sync + cap build android

# Without Android Studio (uses the JDK bundled with Android Studio + the SDK):
npm run android -- devices
npm run android -- build     # gradlew assembleDebug
npm run android -- test      # build + install + launch + 15s of filtered logcat
npm run android -- logs      # tail logcat
```

Requirements: Android Studio (for the SDK/JDK) and a device with USB debugging.

## Verify the Node 18 compatibility

libp2p v3/Fastify 5 target Node 22+, but the mobile runtime is Node 18. This
runs the **actual bundled node project** under Node 18 and asserts the daemon
boots, responds on `/health` and stores a topic:

```bash
npm run test:node18
```

## Anonymous mode (Tor via Orbot)

The mobile node accepts the same Tor settings as the desktop/CLI (through the
plugin's `start` env). On Android, run [Orbot](https://orbot.app/) with a SOCKS
proxy on `127.0.0.1:9050` and an onion service forwarding to the node's listener
(`127.0.0.1:4001`), then start with `PFORUM_TOR=1` and
`PFORUM_ONION=/onion3/<id>/tcp/<port>`.

## Notes

- The debug APK is large (~150 MB) because it embeds the Node runtime for every
  ABI. Release builds should use ABI splits / App Bundle to shrink it.
- iOS runs the Node runtime in interpreter-only mode (no JIT) and forbids
  `process.exit()`, so Android is the primary target.
