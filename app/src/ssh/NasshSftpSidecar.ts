import type { ConnectionIntent } from '../connections/ConnectionIntent';
import {
  connectNasshSecondarySession,
  NasshSecondaryAuthUnavailableError,
  secondaryOptionsFromIntent,
  stripAnsiForError,
} from './NasshSecondarySession';
import type { NasshCommandInstance, NasshSftpClient } from './upstreamTypes';
import type { RemoteFileChannel } from './RemoteImageUploader';
import { NasshIoShim } from './NasshIoShim';

const OPEN_WRITE_CREATE_TRUNCATE_EXCLUSIVE = 0x02 | 0x08 | 0x10 | 0x20;

export class SftpSubsystemUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'SftpSubsystemUnavailableError';
  }
}

export function isSftpSubsystemUnavailable(error: unknown): boolean {
  return error instanceof SftpSubsystemUnavailableError;
}

class NasshRemoteFileChannel implements RemoteFileChannel {
  constructor(
    private readonly client: NasshSftpClient,
    private readonly instance: NasshCommandInstance,
    private readonly io: NasshIoShim,
  ) {}

  get writeChunkSize(): number {
    return this.client.writeChunkSize;
  }

  async home(): Promise<string> {
    const packet = await this.client.realPath('.');
    const path = packet.files[0]?.filename;
    if (!path?.startsWith('/')) throw new Error('SFTP server did not return an absolute home directory.');
    return path;
  }

  async ensureDirectory(path: string): Promise<void> {
    try {
      await this.client.makeDirectory(path);
    } catch (error) {
      await this.client.fileStatus(path).catch(() => {
        throw error;
      });
    }
  }

  async list(path: string): Promise<Array<{ name: string; modified?: number }>> {
    const handle = await this.client.openDirectory(path);
    try {
      return (await this.client.scanDirectory(handle)).map((entry) => ({
        name: entry.filename,
        modified: entry.lastModified === undefined ? undefined : entry.lastModified * 1000,
      }));
    } finally {
      await this.client.closeFile(handle).catch(() => undefined);
    }
  }

  async remove(path: string): Promise<void> {
    await this.client.removeFile(path);
  }

  open(path: string): Promise<string> {
    return this.client.openFile(path, OPEN_WRITE_CREATE_TRUNCATE_EXCLUSIVE);
  }

  async write(handle: string, offset: number, data: Uint8Array): Promise<void> {
    await this.client.writeChunk(handle, offset, data);
  }

  async close(handle: string): Promise<void> {
    await this.client.closeFile(handle);
  }

  async chmod(path: string, mode: number): Promise<void> {
    await this.client.setFileStatus(path, { permissions: mode });
  }

  async rename(from: string, to: string): Promise<void> {
    await this.client.renameFile(from, to);
  }

  dispose(): void {
    this.instance.terminateProgram_();
    this.io.dispose();
  }
}

/** Open a non-interactive SFTP subsystem using the same nassh runtime as the pane. */
export async function connectNasshSftpSidecar(spec: ConnectionIntent, signal?: AbortSignal): Promise<RemoteFileChannel> {
  signal?.throwIfAborted();
  let session;
  try {
    session = await connectNasshSecondarySession(
      secondaryOptionsFromIntent(spec, {
        purpose: { kind: 'sftp' },
        authPromptPolicy: 'silent',
        signal,
      }),
    );
    const client = session.instance.sftpClient;
    const output = session.sink.getOutput();
    if (!client?.isInitialised) {
      if (/subsystem request failed|unknown subsystem|sftp-server[^\r\n]*(?:not found|missing)/i.test(output)) {
        throw new SftpSubsystemUnavailableError('The SSH server does not provide an SFTP subsystem.');
      }
      const detail = stripAnsiForError(output).slice(-500);
      throw new Error(detail ? `SFTP connection failed: ${detail}` : 'SFTP connection failed before subsystem initialization.');
    }
    return new NasshRemoteFileChannel(client, session.instance, session.io);
  } catch (error) {
    session?.dispose();
    if (error instanceof NasshSecondaryAuthUnavailableError) throw error;
    throw error;
  }
}
