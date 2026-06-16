/**
 * Phase 1 bridge: upstream CommandInstance + NasshIoShim → TerminalAdapter / xterm.
 */

import { log } from '../debug/logger';
import type { TerminalAdapter } from '../terminal/TerminalAdapter';
import type { ConnectionStatus, SessionDisconnectReason, SessionStatusMeta } from '../settings/types';
import type { NasshIoShimOptions } from './NasshIoShim';
import { NasshIoShim } from './NasshIoShim';
import { HostKeyGuard } from './HostKeyGuard';
import { installNasshChromePolyfill } from './nasshChromePolyfill';
import { stageIdentityForNassh } from './nasshIdentity';
import { stageKnownHostsForNassh, syncKnownHostsFromNassh } from './nasshKnownHosts';
import { showSecureInputPrompt } from './SecureInputPrompt';
import type {
  NasshCommandInstance,
  NasshCommandModule,
  NasshConnectParams,
  NasshJsModule,
} from './upstreamTypes';
import { isDirectSocketsAvailable } from './DirectSocketProbe';
import { upstreamImport } from './upstreamUrls';

export type NasshCommandBridgeOptions = {
  host: string;
  port: number;
  username: string;
  identityId?: string;
  startupCommand?: string;
  onStatus?: (status: ConnectionStatus, error?: string, meta?: SessionStatusMeta) => void;
};

let nasshModulesPromise: Promise<NasshCommandModule & NasshJsModule> | null = null;

async function loadNasshModules(): Promise<NasshCommandModule & NasshJsModule> {
  if (!nasshModulesPromise) {
    nasshModulesPromise = (async () => {
      installNasshChromePolyfill();
      const [commandMod, nasshMod] = await Promise.all([
        upstreamImport<NasshCommandModule>('nassh/js/nassh_command_instance.js'),
        upstreamImport<NasshJsModule>('nassh/js/nassh.js'),
      ]);
      await nasshMod.setupForWebApp();
      return { ...commandMod, ...nasshMod };
    })();
  }
  return nasshModulesPromise;
}

export class NasshCommandBridge {
  private adapter: TerminalAdapter | null = null;
  private ioShim: NasshIoShim | null = null;
  private commandInstance: NasshCommandInstance | null = null;
  private attachOptions: NasshIoShimOptions | undefined;
  private hostKeyGuard: HostKeyGuard | null = null;
  private hasExited = false;
  private disposed = false;

  constructor(private readonly options: NasshCommandBridgeOptions) {}

  attachTerminal(adapter: TerminalAdapter, options?: NasshIoShimOptions): void {
    this.adapter = adapter;
    this.attachOptions = options;
  }

  resize(cols: number, rows: number): void {
    this.ioShim?.resize(cols, rows);
  }

  async connect(): Promise<void> {
    if (this.disposed) return;
    if (!this.adapter) {
      throw new Error('Terminal adapter not attached');
    }

    if (!isDirectSocketsAvailable()) {
      const message =
        'Direct Sockets (TCPSocket) is unavailable. Install as an IWA with direct-sockets permission.';
      log.socket.error('direct sockets unavailable');
      this.options.onStatus?.('error', message);
      throw new Error(message);
    }

    this.options.onStatus?.('connecting');
    this.hasExited = false;
    log.ssh.info('connecting via nassh CommandInstance', {
      host: this.options.host,
      port: this.options.port,
      username: this.options.username,
      identityId: this.options.identityId,
    });

    const { CommandInstance, getSyncStorage } = await loadNasshModules();

    if (this.disposed) return;

    this.ioShim?.dispose();
    this.hostKeyGuard?.reset();
    this.hostKeyGuard = new HostKeyGuard({
      host: this.options.host,
      port: this.options.port,
      sendResponse: (data) => {
        this.ioShim?.io.sendString(data);
      },
      onDenied: () => {
        this.options.onStatus?.('error', 'Host key verification rejected');
      },
    });

    this.ioShim = new NasshIoShim(this.adapter, {
      onOutput: (data) => {
        this.attachOptions?.onOutput?.(data);
        void this.hostKeyGuard?.handleOutput(data);
      },
    });
    this.ioShim.bindInput();
    this.ioShim.resize(this.adapter.getSize().cols, this.adapter.getSize().rows);

    await stageKnownHostsForNassh();

    const noopLocation = {
      href: globalThis.location?.href ?? '',
      hash: '',
      replace: () => {},
    };

    const syncStorage = getSyncStorage();
    log.storage.debug('using nassh sync storage', {
      storageType: syncStorage?.constructor?.name ?? 'unknown',
    });

    const instance = new CommandInstance({
      io: this.ioShim.io,
      syncStorage,
      terminalLocation: noopLocation,
      onExit: (code) => {
        this.handleExit(code, 'nassh');
      },
    });

    instance.secureInput = async (message, bufLen, echo) => {
      log.ssh.debug('secureInput requested', { echo, bufLen });
      const input = await showSecureInputPrompt(message, bufLen, echo);
      if (input === null) {
        log.ssh.warn('secureInput cancelled');
        return '';
      }
      return input.slice(0, bufLen);
    };

    instance.onPluginExit = async (code) => {
      this.handleExit(code, 'wassh');
    };

    instance.exit = (code, noReconnect) => {
      this.handleExit(code, 'nassh-exit', { noReconnect });
    };

    this.commandInstance = instance;

    let identity: string | undefined;
    if (this.options.identityId) {
      try {
        identity = await stageIdentityForNassh(this.options.identityId);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.options.onStatus?.('error', message);
        throw error;
      }
      if (!identity) {
        log.ssh.warn('continuing without identity key', { identityId: this.options.identityId });
      }
    }

    const connectParams: NasshConnectParams = {
      hostname: this.options.host,
      port: this.options.port,
      username: this.options.username,
      command: this.options.startupCommand ?? '',
      nasshOptions: '--field-trial-direct-sockets',
      identity,
    };

    try {
      log.socket.info('calling CommandInstance.connectTo', {
        host: connectParams.hostname,
        port: connectParams.port,
        identity: connectParams.identity,
      });
      await instance.connectTo(connectParams);
      if (this.disposed) return;
      await syncKnownHostsFromNassh(this.options.host, this.options.port).catch((error) => {
        log.knownHosts.warn('post-connect known_hosts sync failed', { error });
      });
      log.session.info('nassh connected', { host: this.options.host, port: this.options.port });
      this.options.onStatus?.('connected');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.ssh.error('connectTo failed', { message, error });
      this.options.onStatus?.('error', message);
      throw error;
    }
  }

  async disconnect(options?: { reason?: SessionDisconnectReason }): Promise<void> {
    if (this.disposed) return;
    log.ssh.info('disconnecting nassh bridge');
    this.options.onStatus?.('disconnecting');
    this.commandInstance?.terminateProgram_();
    this.commandInstance = null;
    this.ioShim?.dispose();
    this.ioShim = null;
    this.hostKeyGuard?.reset();
    this.hostKeyGuard = null;
    this.options.onStatus?.('disconnected', undefined, {
      disconnectReason: options?.reason ?? 'user',
    });
  }

  dispose(): void {
    this.disposed = true;
    this.commandInstance?.terminateProgram_();
    this.commandInstance = null;
    this.ioShim?.dispose();
    this.ioShim = null;
    this.hostKeyGuard = null;
    this.adapter = null;
  }

  private handleExit(
    code: number,
    source: 'nassh' | 'nassh-exit' | 'wassh',
    detail?: Record<string, unknown>,
  ): void {
    if (this.disposed || this.hasExited) return;
    this.hasExited = true;
    log.ssh.info('nassh bridge exited', { code, source, ...detail });
    this.commandInstance = null;
    this.ioShim?.dispose();
    this.ioShim = null;
    this.hostKeyGuard = null;
    const disconnectReason: SessionDisconnectReason = code === 0 ? 'normal-exit' : 'transport';
    this.options.onStatus?.('disconnected', undefined, { disconnectReason });
  }
}
