import type { ConnectionIntent } from '../connections/ConnectionIntent';
import { resolveSettings } from '../pwa/settingsProfiles';
import { uploadViaNasshExec } from './NasshExecUploader';
import { connectNasshSftpSidecar, isSftpSubsystemUnavailable } from './NasshSftpSidecar';
import {
  RemoteImageUploader,
  type RemoteUploadProgress,
} from './RemoteImageUploader';

export type RemoteImagePasteUploadOptions = {
  signal?: AbortSignal;
  onProgress?: (progress: RemoteUploadProgress) => void;
};

export type RemoteImagePasteUploader = {
  uploadFile(blob: Blob, options?: RemoteImagePasteUploadOptions): Promise<string>;
  dispose(): void;
};

export type RemoteImagePasteUploaderDeps = {
  connect?: (spec: ConnectionIntent, signal?: AbortSignal) => ReturnType<typeof connectNasshSftpSidecar>;
  fallback?: typeof uploadViaNasshExec;
  isSubsystemUnavailable?: typeof isSftpSubsystemUnavailable;
  resolveImagePasteDirectory?: (settingsProfileId?: string) => string;
};

export function createRemoteImagePasteUploader(
  spec: ConnectionIntent,
  deps: RemoteImagePasteUploaderDeps = {},
): RemoteImagePasteUploader {
  const connect =
    deps.connect ?? ((intent, signal) => connectNasshSftpSidecar(intent, signal));
  const fallback =
    deps.fallback ?? ((file, signal, progress, dir) => uploadViaNasshExec(spec, file, signal, progress, dir));
  const isSubsystemUnavailable = deps.isSubsystemUnavailable ?? isSftpSubsystemUnavailable;
  const resolveImagePasteDirectory =
    deps.resolveImagePasteDirectory
    ?? ((settingsProfileId) => resolveSettings(settingsProfileId).imagePasteDirectory);

  let uploader: RemoteImageUploader | null = null;

  return {
    uploadFile(blob, options) {
      const directory = resolveImagePasteDirectory(spec.settingsProfileId);
      uploader ??= new RemoteImageUploader({
        connect: (signal) => connect(spec, signal),
        fallback: (file, signal, progress, dir) => fallback(spec, file, signal, progress, dir),
        isSubsystemUnavailable,
      });
      return uploader.uploadFile(blob, options?.signal, options?.onProgress, directory);
    },
    dispose() {
      uploader?.dispose();
      uploader = null;
    },
  };
}
