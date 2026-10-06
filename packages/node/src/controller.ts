/**
 * Owns the running PFPNode and can rebuild it when the user changes settings
 * (e.g. enabling Tor) from the UI — without restarting the app or the daemon.
 */
import { DEFAULT_CONFIG, type PFPNodeConfig, type TorConfig } from './config';
import {
  loadSettings,
  normalizeOnionMultiaddr,
  saveSettings,
  settingsExist,
  type PfpSettings,
  type TorSettings,
} from './settings';
import { PFPNode } from './sync';

/** Anything the daemon can read the current node from. */
export interface PFPNodeProvider {
  readonly current: PFPNode;
}

/** Provider that can also read/persist settings and reconfigure the node. */
export interface ConfigurableNodeProvider extends PFPNodeProvider {
  getSettings(): PfpSettings;
  updateSettings(settings: PfpSettings): Promise<void>;
}

function torConfigFrom(settings: TorSettings): TorConfig | null {
  if (!settings.enabled) return null;
  const onion = normalizeOnionMultiaddr(settings.onion, settings.onionPort);
  return {
    socksHost: settings.socksHost || '127.0.0.1',
    socksPort: settings.socksPort || 9050,
    announce: onion ? [onion] : [],
  };
}

/** Seeds the settings file from a `--tor`/env config the first time. */
function seedSettingsFromTor(tor: TorConfig): PfpSettings {
  return {
    tor: {
      enabled: true,
      socksHost: tor.socksHost,
      socksPort: tor.socksPort,
      onion: tor.announce[0] ?? '',
      onionPort: 80,
    },
  };
}

/** Merges the base config with the persisted settings (settings win). */
function buildConfig(base: Partial<PFPNodeConfig>, settings: PfpSettings): Partial<PFPNodeConfig> {
  const tor = torConfigFrom(settings.tor);
  return {
    ...base,
    tor,
    enableMdns: tor ? false : (base.enableMdns ?? DEFAULT_CONFIG.enableMdns),
    // In Tor mode listen only on loopback; the onion service forwards here.
    listen: tor ? (base.listen ?? ['/ip4/127.0.0.1/tcp/4001']) : base.listen,
  };
}

export class PFPNodeController implements ConfigurableNodeProvider {
  private node: PFPNode;
  private settings: PfpSettings;

  private constructor(
    private readonly base: Partial<PFPNodeConfig>,
    node: PFPNode,
    settings: PfpSettings,
  ) {
    this.node = node;
    this.settings = settings;
  }

  static async create(options: Partial<PFPNodeConfig> = {}): Promise<PFPNodeController> {
    const dbPath = options.dbPath ?? DEFAULT_CONFIG.dbPath;
    // Seed from CLI/env the first time, then the file is the source of truth.
    if (!settingsExist(dbPath) && options.tor) {
      saveSettings(dbPath, seedSettingsFromTor(options.tor));
    }
    const settings = loadSettings(dbPath);
    const node = await PFPNode.create(buildConfig(options, settings));
    return new PFPNodeController(options, node, settings);
  }

  get current(): PFPNode {
    return this.node;
  }

  getSettings(): PfpSettings {
    return this.settings;
  }

  /** Persists settings and rebuilds the node so the change takes effect now. */
  async updateSettings(settings: PfpSettings): Promise<void> {
    const dbPath = this.base.dbPath ?? DEFAULT_CONFIG.dbPath;
    saveSettings(dbPath, settings);
    const previous = this.node;
    this.node = await PFPNode.create(buildConfig(this.base, settings));
    this.settings = settings;
    await previous.stop();
  }

  async stop(): Promise<void> {
    await this.node.stop();
  }
}

export function isConfigurable(provider: PFPNodeProvider): provider is ConfigurableNodeProvider {
  return (
    typeof (provider as ConfigurableNodeProvider).getSettings === 'function' &&
    typeof (provider as ConfigurableNodeProvider).updateSettings === 'function'
  );
}
