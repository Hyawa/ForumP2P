/**
 * Persisted node settings, editable from the UI (no CLI needed).
 *
 * Stored as a small JSON file next to the SQLite database, so it survives
 * restarts and applies before the node is created.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface TorSettings {
  /** Route all traffic through Tor and expose no IP. */
  enabled: boolean;
  /** Local Tor SOCKS5 proxy host. */
  socksHost: string;
  /** Local Tor SOCKS5 proxy port. */
  socksPort: number;
  /** Our onion host (bare host or full `/onion3/...` multiaddr), if any. */
  onion: string;
  /** Onion virtual port that forwards to the node's listener. */
  onionPort: number;
}

export interface PfpSettings {
  tor: TorSettings;
}

export const DEFAULT_SETTINGS: PfpSettings = {
  tor: {
    enabled: false,
    socksHost: '127.0.0.1',
    socksPort: 9050,
    onion: '',
    onionPort: 80,
  },
};

function clone(settings: PfpSettings): PfpSettings {
  return JSON.parse(JSON.stringify(settings)) as PfpSettings;
}

export function settingsPath(dbPath: string): string {
  const dir = dbPath === ':memory:' ? process.cwd() : dirname(dbPath);
  return join(dir, 'pforum-settings.json');
}

export function settingsExist(dbPath: string): boolean {
  return existsSync(settingsPath(dbPath));
}

export function loadSettings(dbPath: string): PfpSettings {
  const path = settingsPath(dbPath);
  if (!existsSync(path)) return clone(DEFAULT_SETTINGS);
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<PfpSettings>;
    return {
      tor: { ...DEFAULT_SETTINGS.tor, ...(parsed.tor ?? {}) },
    };
  } catch {
    return clone(DEFAULT_SETTINGS);
  }
}

export function saveSettings(dbPath: string, settings: PfpSettings): void {
  const path = settingsPath(dbPath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
}

/** Accepts a bare onion host or a full multiaddr and returns a dialable multiaddr. */
export function normalizeOnionMultiaddr(onion: string, port: number): string | null {
  const trimmed = onion.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.startsWith('/onion')) return trimmed;
  const host = trimmed.replace(/\.onion$/i, '');
  return `/onion3/${host}/tcp/${port}`;
}
