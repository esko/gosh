import type { ConnectionIntent } from '../connections/ConnectionIntent';
import {
  connectNasshSecondarySession,
  NasshSecondaryAuthUnavailableError,
  secondaryOptionsFromIntent,
} from './NasshSecondarySession';
import {
  DEFAULT_REMOTE_PASTE_DIRECTORY,
  shellQuotePath,
  type RemoteUploadProgress,
} from './RemoteImageUploader';

const FRAME_BYTES = 3072;

function extension(type: string): string {
  return ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' } as Record<string, string>)[type] ?? 'bin';
}

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Shell expression for the paste directory (absolute → quoted; relative → under $HOME). */
export function pasteDirectoryShellExpr(directory: string): string {
  const cleaned = (directory.trim() || DEFAULT_REMOTE_PASTE_DIRECTORY).replace(/\/+$/, '');
  if (cleaned.startsWith('/')) return shellQuotePath(cleaned || '/');
  const relative = cleaned.replace(/^\/+/, '').replaceAll('"', '');
  return `"$HOME/${relative}"`;
}

export function buildPortableExecUploadCommand(
  filename: string,
  marker: string,
  directory = DEFAULT_REMOTE_PASTE_DIRECTORY,
): string {
  const dirExpr = pasteDirectoryShellExpr(directory);
  return `umask 077; d=${dirExpr}; mkdir -p "$d" || exit 73; find "$d" -type f \\( -name 'gosh-paste-*' -o -name 'iwa-paste-*' \\) -mtime +7 -exec rm -f {} + 2>/dev/null || :; f="$d/${filename}"; p="$f.part"; trap 'rm -f "$p"' EXIT HUP INT TERM; if printf '' | base64 --decode >/dev/null 2>&1; then flag=--decode; elif printf '' | base64 -D >/dev/null 2>&1; then flag=-D; else exit 69; fi; { while IFS= read -r line; do [ "$line" = '${marker}' ] && break; printf %s "$line"; done; } | base64 "$flag" >"$p" && chmod 600 "$p" && mv -f "$p" "$f" || exit 74; trap - EXIT HUP INT TERM; printf '\\nIWA_UPLOAD_OK:%s\\n' "$(printf %s "$f" | base64 | tr -d '\\n')"`;
}

/** Portable Linux/macOS SSH-exec upload used only when SFTP is unavailable. */
export async function uploadViaNasshExec(
  spec: ConnectionIntent,
  blob: Blob,
  signal?: AbortSignal,
  onProgress?: (progress: RemoteUploadProgress) => void,
  directory = DEFAULT_REMOTE_PASTE_DIRECTORY,
): Promise<string> {
  signal?.throwIfAborted();
  const token = crypto.randomUUID().replaceAll('-', '');
  const marker = `__IWA_UPLOAD_EOF_${token}__`;
  const filename = `gosh-paste-${token}.${extension(blob.type)}`;
  const command = buildPortableExecUploadCommand(filename, marker, directory);

  let session;
  let cleanupResult = (): void => undefined;
  let rejectResult: (reason?: unknown) => void = () => undefined;

  try {
    session = await connectNasshSecondarySession(
      secondaryOptionsFromIntent(spec, {
        purpose: { kind: 'exec', remoteCommand: command },
        authPromptPolicy: 'silent',
        sinkMode: 'line-pump',
        signal,
      }),
    );

    const result = new Promise<string>((resolve, reject) => {
      let output = '';
      const onAbort = () => rejectResult(signal?.reason);
      const timeout = window.setTimeout(() => rejectResult(new Error('SSH upload timed out.')), 120_000);
      const offOutput = session!.sink.onOutput((chunk) => {
        output = (output + chunk).slice(-16_384);
        const match = /IWA_UPLOAD_OK:([A-Za-z0-9+/=]+)/.exec(output);
        if (!match) return;
        cleanupResult();
        try {
          resolve(atob(match[1]!));
        } catch (error) {
          reject(error);
        }
      });
      rejectResult = (reason) => {
        cleanupResult();
        reject(reason);
      };
      cleanupResult = () => {
        offOutput.dispose();
        window.clearTimeout(timeout);
        signal?.removeEventListener('abort', onAbort);
      };
      signal?.addEventListener('abort', onAbort, { once: true });
    });

    const bytes = new Uint8Array(await blob.arrayBuffer());
    for (let offset = 0; offset < bytes.length; offset += FRAME_BYTES) {
      signal?.throwIfAborted();
      const chunk = bytes.subarray(offset, Math.min(bytes.length, offset + FRAME_BYTES));
      session.sink.input(`${base64(chunk)}\n`);
      onProgress?.({ uploaded: offset + chunk.length, total: bytes.length });
    }
    session.sink.input(`${marker}\n`);
    return await result;
  } catch (error) {
    if (error instanceof NasshSecondaryAuthUnavailableError) throw error;
    throw error;
  } finally {
    cleanupResult();
    session?.dispose();
  }
}
