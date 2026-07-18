import { describe, expect, it, vi } from 'vitest';
import type { ConnectionIntent } from '../connections/ConnectionIntent';
import { createRemoteImagePasteUploader } from './remoteImagePaste';
import type { RemoteFileChannel } from './RemoteImageUploader';

const spec: ConnectionIntent = {
  protocol: 'ssh',
  hostname: 'example.test',
  username: 'user',
  args: [],
  settingsProfileId: 'default',
};

function fakeChannel(): RemoteFileChannel {
  return {
    writeChunkSize: 64 * 1024,
    home: async () => '/home/test',
    ensureDirectory: async () => undefined,
    list: async () => [],
    remove: async () => undefined,
    open: async () => 'h',
    write: async () => undefined,
    close: async () => undefined,
    chmod: async () => undefined,
    rename: async () => undefined,
    dispose: vi.fn(),
  };
}

describe('createRemoteImagePasteUploader', () => {
  it('resolves the settings profile paste directory on each upload', async () => {
    const resolveImagePasteDirectory = vi.fn(() => '/var/tmp/gosh');
    const connect = vi.fn(async () => fakeChannel());
    const uploader = createRemoteImagePasteUploader(spec, { connect, resolveImagePasteDirectory });

    await expect(uploader.uploadFile(new Blob(['x'], { type: 'image/png' }))).resolves.toMatch(
      /^\/var\/tmp\/gosh\/gosh-paste-.+\.png$/,
    );

    expect(resolveImagePasteDirectory).toHaveBeenCalledWith('default');
    expect(connect).toHaveBeenCalledWith(spec, undefined);
  });

  it('reuses one lazy RemoteImageUploader across uploads', async () => {
    const connect = vi.fn(async () => fakeChannel());
    const uploader = createRemoteImagePasteUploader(spec, {
      connect,
      resolveImagePasteDirectory: () => '/tmp',
    });

    await uploader.uploadFile(new Blob(['a'], { type: 'image/png' }));
    await uploader.uploadFile(new Blob(['b'], { type: 'image/png' }));

    expect(connect).toHaveBeenCalledOnce();
  });

  it('passes the resolved directory to the exec fallback path', async () => {
    const unavailable = new Error('subsystem unavailable');
    const fallback = vi.fn(async () => '/fallback/image.png');
    const uploader = createRemoteImagePasteUploader(spec, {
      connect: async () => { throw unavailable; },
      fallback,
      isSubsystemUnavailable: (error) => error === unavailable,
      resolveImagePasteDirectory: () => '.cache/gosh/pastes',
    });

    await expect(uploader.uploadFile(new Blob(['x'], { type: 'image/png' }))).resolves.toBe('/fallback/image.png');
    expect(fallback).toHaveBeenCalledWith(expect.any(Blob), undefined, undefined, '.cache/gosh/pastes');
  });

  it('disposes the underlying uploader channel', async () => {
    const channel = fakeChannel();
    const uploader = createRemoteImagePasteUploader(spec, {
      connect: async () => channel,
      resolveImagePasteDirectory: () => '/tmp',
    });

    await uploader.uploadFile(new Blob(['x'], { type: 'image/png' }));
    uploader.dispose();
    await Promise.resolve();

    expect(channel.dispose).toHaveBeenCalledOnce();
  });
});
