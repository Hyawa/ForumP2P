import { contextBridge } from 'electron';

// The main process passes the (random) daemon API URL via an extra argument so
// the renderer never has to guess the port.
const arg = process.argv.find((value) => value.startsWith('--pf-api='));
const apiBase = arg ? arg.slice('--pf-api='.length) : 'http://127.0.0.1:7331';

contextBridge.exposeInMainWorld('__PF_API__', apiBase);
