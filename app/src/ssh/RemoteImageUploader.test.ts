import { describe, expect, it, vi } from 'vitest';
import {
  RemoteImageUploader,
  resolveRemotePasteDirectory,
  shellQuotePath,
  type RemoteFileChannel,
} from './RemoteImageUploader';

function fakeChannel(): RemoteFileChannel & { writes: Uint8Array[]; calls: string[] } {
  const calls: string[] = [];
  return {
    writeChunkSize: 2, writes: [], calls,
    home: async () => '/home/test', ensureDirectory: async (p) => { calls.push(`mkdir:${p}`); },
    list: async () => [
      { name: 'gosh-paste-old.png', modified: 1 },
      { name: 'iwa-paste-legacy.png', modified: 1 },
      { name: 'notes.png', modified: 1 },
    ],
    remove: async (p) => { calls.push(`rm:${p}`); }, open: async (p) => { calls.push(`open:${p}`); return 'h'; },
    write: async function (_h, _o, data) { this.writes.push(data.slice()); calls.push(`write:${data.length}`); }, close: async () => { calls.push('close'); },
    chmod: async (p, mode) => { calls.push(`chmod:${p}:${mode.toString(8)}`); }, rename: async (a, b) => { calls.push(`rename:${a}:${b}`); }, dispose: vi.fn(),
  };
}

describe('RemoteImageUploader', () => {
  it('uploads privately through a temporary file and atomically renames it under /tmp by default', async () => {
    const channel = fakeChannel();
    const progress = vi.fn();
    const uploader = new RemoteImageUploader({ connect: async () => channel, randomName: () => 'fixed', now: () => 9 * 24 * 60 * 60 * 1000 });
    const path = await uploader.uploadFile(new Blob(['hello'], { type: 'image/png' }), undefined, progress);
    expect(path).toBe('/tmp/gosh-paste-fixed.png');
    expect(channel.calls).toContain('mkdir:/tmp');
    expect(channel.calls).toContain(`chmod:${path}.part:600`);
    expect(channel.calls.at(-1)).toBe(`rename:${path}.part:${path}`);
    expect(channel.calls).toContain('rm:/tmp/gosh-paste-old.png');
    expect(channel.calls).toContain('rm:/tmp/iwa-paste-legacy.png');
    expect(channel.calls).not.toContain('rm:/tmp/notes.png');
    expect(progress).toHaveBeenLastCalledWith({ uploaded: 5, total: 5 });
    expect(new TextDecoder().decode(Uint8Array.from(channel.writes.flatMap((chunk) => [...chunk])))).toBe('hello');
  });

  it('honors a configured absolute or home-relative directory', async () => {
    expect(resolveRemotePasteDirectory('/home/test', '/var/tmp/gosh')).toBe('/var/tmp/gosh');
    expect(resolveRemotePasteDirectory('/home/test', '.cache/gosh/pastes')).toBe('/home/test/.cache/gosh/pastes');

    const channel = fakeChannel();
    const uploader = new RemoteImageUploader({
      connect: async () => channel,
      directory: '.cache/gosh/pastes',
      randomName: () => 'rel',
    });
    await expect(uploader.uploadFile(new Blob(['x'], { type: 'image/png' }))).resolves.toBe(
      '/home/test/.cache/gosh/pastes/gosh-paste-rel.png',
    );
    expect(channel.calls).not.toContain('mkdir:/home');
    expect(channel.calls).not.toContain('mkdir:/home/test');
    expect(channel.calls).toContain('mkdir:/home/test/.cache');
    expect(channel.calls).toContain('mkdir:/home/test/.cache/gosh');
    expect(channel.calls).toContain('mkdir:/home/test/.cache/gosh/pastes');
  });

  it('cleans partial files after cancellation', async () => {
    const channel = fakeChannel();
    const controller = new AbortController();
    channel.write = async () => { controller.abort(); };
    const uploader = new RemoteImageUploader({ connect: async () => channel, randomName: () => 'cancel' });
    await expect(uploader.uploadFile(new Blob(['hello']), controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(channel.calls).toContain('rm:/tmp/gosh-paste-cancel.bin.part');
  });

  it('quotes paths without allowing shell injection', () => {
    expect(shellQuotePath("/tmp/a'b.png")).toBe("'/tmp/a'\"'\"'b.png'");
  });

  it('falls back only when the SFTP subsystem is unavailable', async () => {
    const unavailable = new Error('subsystem unavailable');
    const fallback = vi.fn(async () => '/fallback/image.png');
    const uploader = new RemoteImageUploader({
      connect: async () => { throw unavailable; }, fallback,
      isSubsystemUnavailable: (error) => error === unavailable,
    });
    await expect(uploader.uploadFile(new Blob(['x']))).resolves.toBe('/fallback/image.png');
    expect(fallback).toHaveBeenCalledOnce();
    expect(fallback).toHaveBeenCalledWith(expect.any(Blob), undefined, undefined, '/tmp');

    const denied = new Error('permission denied');
    const deniedUploader = new RemoteImageUploader({
      connect: async () => { throw denied; }, fallback,
      isSubsystemUnavailable: () => false,
    });
    await expect(deniedUploader.uploadFile(new Blob(['x']))).rejects.toBe(denied);
  });
});
