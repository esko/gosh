export const DEFAULT_REMOTE_PASTE_DIRECTORY = '/tmp';
/** @deprecated Use DEFAULT_REMOTE_PASTE_DIRECTORY (`/tmp`). Kept for import compatibility. */
export const REMOTE_PASTE_DIRECTORY = DEFAULT_REMOTE_PASTE_DIRECTORY;
export const REMOTE_PASTE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export type RemoteUploadProgress = { uploaded: number; total: number };

export interface RemoteFileChannel {
  readonly writeChunkSize: number;
  home(): Promise<string>;
  ensureDirectory(path: string): Promise<void>;
  list(path: string): Promise<Array<{ name: string; modified?: number }>>;
  remove(path: string): Promise<void>;
  open(path: string): Promise<string>;
  write(handle: string, offset: number, data: Uint8Array): Promise<void>;
  close(handle: string): Promise<void>;
  chmod(path: string, mode: number): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  dispose(): void;
}

export type RemoteImageUploaderOptions = {
  connect: (signal?: AbortSignal) => Promise<RemoteFileChannel>;
  fallback?: (
    blob: Blob,
    signal?: AbortSignal,
    onProgress?: (progress: RemoteUploadProgress) => void,
    directory?: string,
  ) => Promise<string>;
  isSubsystemUnavailable?: (error: unknown) => boolean;
  /** Absolute (`/tmp`) or home-relative (`.cache/gosh/pastes`) paste directory. */
  directory?: string;
  now?: () => number;
  randomName?: () => string;
};

function extension(type: string): string {
  return ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' } as Record<string, string>)[type] ?? 'bin';
}

export function shellQuotePath(path: string): string {
  return `'${path.replaceAll("'", `'"'"'`)}'`;
}

/**
 * Resolve the remote paste directory. Absolute paths are used as-is; relative
 * paths are joined under the remote home directory.
 */
export function resolveRemotePasteDirectory(
  home: string,
  configured = DEFAULT_REMOTE_PASTE_DIRECTORY,
): string {
  const dir = (configured.trim() || DEFAULT_REMOTE_PASTE_DIRECTORY).replace(/\/+$/, '');
  if (dir.startsWith('/')) return dir || '/';
  const base = home.replace(/\/+$/, '');
  return `${base}/${dir.replace(/^\/+/, '')}`;
}

/**
 * Create each path segment of `directory` (best-effort mkdir -p).
 * When `base` is set (usually `$HOME`), only segments at or below `base` are
 * created — avoids SFTP permission errors on `/home`.
 */
export async function ensureRemoteDirectoryTree(
  channel: RemoteFileChannel,
  directory: string,
  base?: string,
): Promise<void> {
  if (!directory || directory === '/') return;
  const root = base && (directory === base || directory.startsWith(`${base}/`)) ? base : '';
  if (root) {
    let acc = root;
    for (const part of directory.slice(root.length).split('/').filter(Boolean)) {
      acc += `/${part}`;
      await channel.ensureDirectory(acc);
    }
    return;
  }
  let acc = '';
  for (const part of directory.split('/').filter(Boolean)) {
    acc += `/${part}`;
    await channel.ensureDirectory(acc);
  }
}

export class RemoteImageUploader {
  private channelPromise: Promise<RemoteFileChannel> | null = null;

  constructor(private readonly options: RemoteImageUploaderOptions) {}

  async uploadFile(
    blob: Blob,
    signal?: AbortSignal,
    onProgress?: (progress: RemoteUploadProgress) => void,
    directoryOverride?: string,
  ): Promise<string> {
    signal?.throwIfAborted();
    const configured = directoryOverride ?? this.options.directory ?? DEFAULT_REMOTE_PASTE_DIRECTORY;
    let channel: RemoteFileChannel;
    try {
      channel = await (this.channelPromise ??= this.options.connect(signal));
    } catch (error) {
      this.channelPromise = null;
      if (this.options.fallback && this.options.isSubsystemUnavailable?.(error)) {
        return this.options.fallback(blob, signal, onProgress, configured);
      }
      throw error;
    }
    signal?.throwIfAborted();
    const home = (await channel.home()).replace(/\/$/, '');
    const directory = resolveRemotePasteDirectory(home, configured);
    await ensureRemoteDirectoryTree(channel, directory, home);
    await this.cleanup(channel, directory);

    const token = this.options.randomName?.() ?? crypto.randomUUID().replaceAll('-', '');
    const finalPath = `${directory}/gosh-paste-${token}.${extension(blob.type)}`;
    const temporaryPath = `${finalPath}.part`;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let handle: string | null = null;
    try {
      handle = await channel.open(temporaryPath);
      const size = channel.writeChunkSize > 0 ? channel.writeChunkSize : 64 * 1024;
      for (let offset = 0; offset < bytes.length; offset += size) {
        signal?.throwIfAborted();
        const chunk = bytes.subarray(offset, Math.min(bytes.length, offset + size));
        await channel.write(handle, offset, chunk);
        onProgress?.({ uploaded: offset + chunk.length, total: bytes.length });
        signal?.throwIfAborted();
      }
      await channel.close(handle);
      handle = null;
      await channel.chmod(temporaryPath, 0o600);
      await channel.rename(temporaryPath, finalPath);
      return finalPath;
    } catch (error) {
      if (handle) await channel.close(handle).catch(() => undefined);
      await channel.remove(temporaryPath).catch(() => undefined);
      throw error;
    }
  }

  private async cleanup(channel: RemoteFileChannel, directory: string): Promise<void> {
    try {
      const cutoff = (this.options.now?.() ?? Date.now()) - REMOTE_PASTE_RETENTION_MS;
      const files = await channel.list(directory);
      // Match current `gosh-paste-*` and legacy `iwa-paste-*` names.
      const pasteName = /^(?:gosh|iwa)-paste-[a-zA-Z0-9_-]+\.(?:png|jpg|webp|gif|bin)(?:\.part)?$/;
      await Promise.all(files.filter((file) => pasteName.test(file.name) && (file.modified ?? Infinity) < cutoff)
        .map((file) => channel.remove(`${directory}/${file.name}`).catch(() => undefined)));
    } catch {
      // Retention is best-effort and must never prevent a paste.
    }
  }

  dispose(): void {
    void this.channelPromise?.then((channel) => channel.dispose()).catch(() => undefined);
    this.channelPromise = null;
  }
}
