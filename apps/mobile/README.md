# PeerForum mobile (Capacitor)

Native Android/iOS shell around the same React UI used by the desktop app and
the browser. It is built with [Capacitor](https://capacitorjs.com/).

## What works today

- `npm run sync` builds the web UI (`packages/web`) and copies it into the
  native projects.
- The packaged UI talks to a **PeerForum daemon over HTTP**. Because a phone
  cannot run the Node.js/libp2p node inside a WebView, the app connects to a
  node that is running elsewhere.

### Pointing the app at a node

The API base URL is resolved at runtime (see `packages/web/public/pf-runtime.js`),
so you do not need to rebuild to switch nodes. In order of precedence:

1. `window.__PF_API__` (injected by a native shell — not used on mobile yet)
2. `?api=<url>` query parameter
3. `localStorage["pf_api"]`

For a trusted-LAN test, run a daemon reachable on your network **with a token**:

```bash
npm run daemon -- --host 0.0.0.0 --port 7331 --token "$PFORUM_TOKEN"
```

Then on the device open the app with `?api=http://<your-pc-ip>:7331` (or set
`localStorage.pf_api`) and provide the token through the shell's storage when
that UI lands.

> ⚠️ This LAN mode exposes your IP and is only for functional testing. It is
> **not** anonymous. See the roadmap below for Tor.

## Commands

```bash
# from apps/mobile
npm run add:android      # one-time: create the android/ project
npm run add:ios          # one-time: create the ios/ project (macOS only)
npm run sync             # build the web UI + copy into native projects
npm run open:android     # open in Android Studio
npm run open:ios         # open in Xcode
npm run build:android    # sync + assemble
```

Requirements: Android Studio + JDK for Android; Xcode for iOS.

## Roadmap: true on-device node + anonymity

Running the full node on a phone is the remaining piece and is deliberately not
faked here. Two viable paths:

1. **Embedded Node runtime** — run the existing `@pforum/node` daemon inside the
   app using a `nodejs-mobile` integration (a custom Capacitor plugin), and let
   the WebView talk to `http://127.0.0.1:<port>` exactly like desktop.
2. **Browser-native node** — replace `node:sqlite` with WASM SQLite
   (`@sqlite.org/sqlite-wasm`) and use libp2p's browser transports
   (WebRTC/WebTransport). Larger refactor.

For **anonymity on mobile**, the node must reach the network through Tor. On
Android this means routing the daemon through **Orbot** (SOCKS5) and publishing
an onion service; the plan mirrors the desktop `--tor` mode.
