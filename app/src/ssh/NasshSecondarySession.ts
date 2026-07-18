import type { ConnectionIntent } from '../connections/ConnectionIntent';
import { HeadlessTerminalSink, type HeadlessTerminalSinkMode } from './HeadlessTerminalSink';
import { HostKeyGuard } from './HostKeyGuard';
import { NasshIoShim } from './NasshIoShim';
import {
  composeSshArgstr,
  loadNasshModules,
  NASSH_ENVIRONMENT,
  withTruecolorRemoteCommand,
} from './NasshCommandBridge';
import { createNasshAuthAttempt, type AuthPromptPolicy } from './nasshAuthAttempt';
import { createNasshTerminalLocation, createNasshTerminalWindow } from './nasshTerminalWindow';
import { stageIdentityForNassh, removeIdentityFromNassh } from './nasshIdentity';
import { stageKnownHostsForNassh, syncKnownHostsFromNassh } from './nasshKnownHosts';
import { SAVED_CREDENTIALS_UNAVAILABLE_MESSAGE } from './secureInputCredentials';
import type { NasshCommandInstance, NasshConnectParams } from './upstreamTypes';

export type NasshSecondaryPurpose =
  | { kind: 'sftp' }
  | { kind: 'exec'; remoteCommand: string };

export type NasshSecondarySessionOptions = {
  hostname: string;
  port?: number;
  username: string;
  identityId?: string;
  argstr?: string;
  authPromptPolicy: AuthPromptPolicy;
  purpose: NasshSecondaryPurpose;
  allowHostKeyTtyResponse?: boolean;
  sinkMode?: HeadlessTerminalSinkMode;
  signal?: AbortSignal;
};

export type NasshSecondarySessionConnection = {
  instance: NasshCommandInstance;
  io: NasshIoShim;
  sink: HeadlessTerminalSink;
  hostKeyGuard: HostKeyGuard;
  authUnavailable: boolean;
  terminate(): void;
  dispose(): void;
};

export class NasshSecondaryAuthUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'NasshSecondaryAuthUnavailableError';
  }
}

export function secondaryOptionsFromIntent(
  spec: ConnectionIntent,
  overrides: {
    purpose: NasshSecondaryPurpose;
    authPromptPolicy: AuthPromptPolicy;
    allowHostKeyTtyResponse?: boolean;
    sinkMode?: HeadlessTerminalSinkMode;
    signal?: AbortSignal;
  },
): NasshSecondarySessionOptions {
  return {
    hostname: spec.hostname,
    port: spec.port ?? 22,
    username: spec.username ?? '',
    identityId: spec.identityId,
    argstr: spec.argstr,
    signal: overrides.signal,
    sinkMode: overrides.sinkMode,
    allowHostKeyTtyResponse: overrides.allowHostKeyTtyResponse,
    authPromptPolicy: overrides.authPromptPolicy,
    purpose: overrides.purpose,
  };
}

function defaultSinkMode(purpose: NasshSecondaryPurpose): HeadlessTerminalSinkMode {
  if (purpose.kind === 'exec') return 'line-pump';
  if (purpose.kind === 'sftp') return 'capture-tail';
  return 'mute';
}

function buildConnectParams(
  options: NasshSecondarySessionOptions,
  identity: string | undefined,
): NasshConnectParams {
  const port = options.port ?? 22;
  const base: NasshConnectParams = {
    hostname: options.hostname,
    port,
    username: options.username,
    argstr: options.argstr ?? '',
    nasshOptions: '--field-trial-direct-sockets',
    identity,
  };
  if (options.purpose.kind === 'exec') {
    return {
      ...base,
      argstr: composeSshArgstr(
        options.argstr,
        withTruecolorRemoteCommand(options.purpose.remoteCommand),
      ),
    };
  }
  return base;
}

/**
 * Bootstrap a short-lived nassh CommandInstance for secondary-session purposes
 * (SFTP sidecar, exec upload). Interactive pane sessions stay on NasshCommandBridge.
 */
export async function connectNasshSecondarySession(
  options: NasshSecondarySessionOptions,
): Promise<NasshSecondarySessionConnection> {
  options.signal?.throwIfAborted();

  const { CommandInstance, getSyncStorage } = await loadNasshModules();
  await stageKnownHostsForNassh();

  const port = options.port ?? 22;
  const sinkMode = options.sinkMode ?? defaultSinkMode(options.purpose);
  const sink = new HeadlessTerminalSink({ mode: sinkMode });
  let disposed = false;
  let authUnavailable = false;

  const hostKeyGuard = new HostKeyGuard({
    host: options.hostname,
    port,
    sendResponse: (data) => sink.input(data),
    allowTtyResponse: options.allowHostKeyTtyResponse,
  });

  const io = new NasshIoShim(sink, {
    onOutput: (data) => {
      void hostKeyGuard.handleOutput(data);
    },
    filterOutput: (data) => hostKeyGuard.filterTerminalOutput(data) ?? data,
  });
  io.bindInput();

  const instance = new CommandInstance({
    io: io.io,
    syncStorage: getSyncStorage(),
    terminalLocation: createNasshTerminalLocation(),
    terminalWindow: createNasshTerminalWindow(),
    environment: { ...NASSH_ENVIRONMENT },
    isSftp: options.purpose.kind === 'sftp',
  });

  if (options.purpose.kind === 'sftp') {
    instance.onSftpInitialised = () => undefined;
  }
  instance.exit = () => instance.terminateProgram_();

  const credentialTarget = {
    username: options.username,
    host: options.hostname,
    port,
  };

  const authAttempt = createNasshAuthAttempt({
    policy: options.authPromptPolicy,
    target: credentialTarget,
    hostKeyGuard,
    isInactive: () => disposed,
    onCancel: (reason) => {
      if (reason === 'unavailable') authUnavailable = true;
      instance.terminateProgram_();
    },
  });
  instance.secureInput = authAttempt.secureInput;

  let identity: string | undefined;
  if (options.identityId) {
    identity = await stageIdentityForNassh(options.identityId);
  }

  const params = buildConnectParams(options, identity);
  const abort = () => instance.terminateProgram_();
  options.signal?.addEventListener('abort', abort, { once: true });

  const terminate = (): void => {
    instance.terminateProgram_();
  };

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    instance.terminateProgram_();
    io.dispose();
    hostKeyGuard.reset();
    sink.dispose();
    options.signal?.removeEventListener('abort', abort);
  };

  try {
    try {
      await instance.connectTo(params);
    } finally {
      if (options.identityId) {
        await removeIdentityFromNassh(options.identityId);
      }
    }
    options.signal?.throwIfAborted();
    await syncKnownHostsFromNassh(options.hostname, port).catch(() => undefined);

    if (authAttempt.wasUnavailable()) {
      throw new NasshSecondaryAuthUnavailableError(SAVED_CREDENTIALS_UNAVAILABLE_MESSAGE);
    }

    return {
      instance,
      io,
      sink,
      hostKeyGuard,
      authUnavailable,
      terminate,
      dispose,
    };
  } catch (error) {
    dispose();
    if (authUnavailable || authAttempt.wasUnavailable()) {
      throw new NasshSecondaryAuthUnavailableError(SAVED_CREDENTIALS_UNAVAILABLE_MESSAGE, { cause: error });
    }
    throw error;
  }
}

/** Strip ANSI escapes for human-readable secondary-session error snippets. */
export function stripAnsiForError(text: string): string {
  return text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').trim();
}
