/**
 * Phase 1 bridge: upstream CommandInstance + stub hterm.IO → TerminalAdapter / xterm.
 */

import type { TerminalAdapter } from '../terminal/TerminalAdapter';
import type { ConnectionStatus } from '../settings/types';
import type { HtermIoBridgeOptions } from './HtermIoBridge';
import { HtermIoBridge, loadHtermTerminalIo } from './HtermIoBridge';
import type {
  NasshCommandInstance,
  NasshCommandModule,
  NasshConnectParams,
  NasshJsModule,
} from './upstreamTypes';
import { upstreamImport } from './upstreamUrls';

export type NasshCommandBridgeOptions = {
  host: string;
  port: number;
  username: string;
  startupCommand?: string;
  onStatus?: (status: ConnectionStatus, error?: string) => void;
};

let nasshModulesPromise: Promise<NasshCommandModule & NasshJsModule> | null = null;

async function loadNasshModules(): Promise<NasshCommandModule & NasshJsModule> {
  if (!nasshModulesPromise) {
    nasshModulesPromise = (async () => {
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
  private htermBridge: HtermIoBridge | null = null;
  private commandInstance: NasshCommandInstance | null = null;
  private disposed = false;

  constructor(private readonly options: NasshCommandBridgeOptions) {}

  attachTerminal(adapter: TerminalAdapter, options?: HtermIoBridgeOptions): void {
    this.adapter = adapter;
    adapter.onResize((cols, rows) => {
      this.htermBridge?.resize(cols, rows);
    });
    this.attachOptions = options;
  }

  private attachOptions: HtermIoBridgeOptions | undefined;

  async connect(): Promise<void> {
    if (this.disposed) return;
    if (!this.adapter) {
      throw new Error('Terminal adapter not attached');
    }

    this.options.onStatus?.('connecting');

    const [{ CommandInstance, getSyncStorage }, hterm] = await Promise.all([
      loadNasshModules(),
      loadHtermTerminalIo(),
    ]);

    if (this.disposed) return;

    this.htermBridge?.dispose();
    this.htermBridge = new HtermIoBridge(this.adapter, hterm, {
      onOutput: this.attachOptions?.onOutput,
    });
    this.htermBridge.bindInput();
    this.htermBridge.resize(this.adapter.getSize().cols, this.adapter.getSize().rows);

    const noopLocation = {
      href: globalThis.location?.href ?? '',
      hash: '',
      replace: () => {},
    };

    const instance = new CommandInstance({
      io: this.htermBridge.io,
      syncStorage: getSyncStorage(),
      terminalLocation: noopLocation,
      onExit: (code) => {
        if (this.disposed) return;
        void code;
        this.options.onStatus?.('disconnected');
      },
    });

    instance.secureInput = async (message, bufLen, echo) => {
      const input = globalThis.prompt(message) ?? '';
      if (!echo) {
        return input.slice(0, bufLen);
      }
      return input.slice(0, bufLen);
    };

    instance.onPluginExit = async (code) => {
      if (this.disposed) return;
      void code;
      this.options.onStatus?.('disconnected');
    };

    this.commandInstance = instance;

    const connectParams: NasshConnectParams = {
      hostname: this.options.host,
      port: this.options.port,
      username: this.options.username,
      command: this.options.startupCommand ?? '',
      nasshOptions: '--field-trial-direct-sockets',
    };

    try {
      await instance.connectTo(connectParams);
      if (this.disposed) return;
      this.options.onStatus?.('connected');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.options.onStatus?.('error', message);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.disposed) return;
    this.options.onStatus?.('disconnecting');
    this.commandInstance?.terminateProgram_();
    this.commandInstance = null;
    this.htermBridge?.dispose();
    this.htermBridge = null;
    this.options.onStatus?.('disconnected');
  }

  dispose(): void {
    this.disposed = true;
    this.commandInstance?.terminateProgram_();
    this.commandInstance = null;
    this.htermBridge?.dispose();
    this.htermBridge = null;
    this.adapter = null;
  }
}
