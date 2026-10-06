/*
 * Runtime API-base override.
 *
 * Runs before the app bundle. Resolution order (first match wins):
 *   1. window.__PF_API__ already injected (e.g. Electron preload)
 *   2. ?api=<url> query parameter
 *   3. localStorage["pf_api"]
 *
 * This lets the packaged desktop/mobile shells point the UI at a node without
 * rebuilding, and lets mobile testers connect to a daemon on their LAN.
 */
(function () {
  if (typeof window === 'undefined' || window.__PF_API__) return;

  var fromQuery = new URLSearchParams(window.location.search).get('api');
  var fromStorage;
  try {
    fromStorage = window.localStorage.getItem('pf_api');
  } catch (_) {
    fromStorage = null;
  }

  var api = fromQuery || fromStorage;
  if (api) window.__PF_API__ = api;
})();
