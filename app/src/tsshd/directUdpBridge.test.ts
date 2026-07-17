import { describe, expect, it, vi } from 'vitest';
import { createDirectUdpBridge, type DirectUdpSocketConstructor } from './directUdpBridge';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe('createDirectUdpBridge', () => {
  it('waits for open, preserves datagram order/backpressure, unwraps packet data, and closes locks', async () => {
    const opened = deferred<{ readable: ReadableStream<{ data: ArrayBuffer | ArrayBufferView }>; writable: WritableStream<{ data: ArrayBuffer }> }>();
    const firstWrite = deferred<void>();
    const writes: number[][] = [];
    let readController!: ReadableStreamDefaultController<{ data: ArrayBuffer | ArrayBufferView }>;
    const readable = new ReadableStream({ start(controller) { readController = controller; } });
    const writable = new WritableStream<{ data: ArrayBuffer }>({
      async write(message) {
        writes.push([...new Uint8Array(message.data)]);
        if (writes.length === 1) await firstWrite.promise;
      },
    });
    const close = vi.fn(async () => undefined);
    const options: unknown[] = [];
    class FakeSocket {
      opened = opened.promise;
      closed = new Promise<void>(() => undefined);
      constructor(value: unknown) { options.push(value); }
      close = close;
    }

    const packets = vi.fn();
    const errors = vi.fn();
    const onOpened = vi.fn();
    const bridge = createDirectUdpBridge(FakeSocket as unknown as DirectUdpSocketConstructor);
    const handle = bridge.open('example.com', 61382, packets, errors, onOpened);
    const done1 = vi.fn();
    const done2 = vi.fn();
    handle.send(new Uint8Array([1]), done1);
    handle.send(new Uint8Array([2]), done2);
    expect(writes).toEqual([]);

    opened.resolve({ readable, writable });
    await vi.waitFor(() => expect(writes).toEqual([[1]]));
    expect(onOpened).toHaveBeenCalledWith();
    expect(writes).toEqual([[1]]);
    firstWrite.resolve();
    await vi.waitFor(() => expect(writes).toEqual([[1], [2]]));
    await vi.waitFor(() => expect(done2).toHaveBeenCalledWith());

    readController.enqueue({ data: new Uint8Array([9, 3, 4, 9]).subarray(1, 3) });
    await vi.waitFor(() => expect(packets).toHaveBeenCalledOnce());
    expect([...packets.mock.calls[0]![0]]).toEqual([3, 4]);
    expect(options).toEqual([{ remoteAddress: 'example.com', remotePort: 61382 }]);

    const closed = new Promise<void>((resolve) => handle.close(resolve));
    await closed;
    expect(close).toHaveBeenCalledOnce();
    expect(errors).not.toHaveBeenCalled();
  });

  it('reports an asynchronous socket-open failure to both Go callbacks', async () => {
    class FailingSocket {
      opened = Promise.reject(new Error('permission denied'));
      closed = new Promise<void>(() => undefined);
      close = vi.fn(async () => undefined);
    }
    const onOpened = vi.fn();
    const onError = vi.fn();
    createDirectUdpBridge(FailingSocket as unknown as DirectUdpSocketConstructor)
      .open('host', 61001, vi.fn(), onError, onOpened);
    await vi.waitFor(() => expect(onOpened).toHaveBeenCalledWith('permission denied'));
    expect(onError).toHaveBeenCalledWith('permission denied');
  });

  it('rejects invalid destinations and unavailable Direct Sockets synchronously', () => {
    expect(() => createDirectUdpBridge(undefined).open('host', 1, vi.fn(), vi.fn(), vi.fn())).toThrow('UDPSocket');
    class FakeSocket {}
    const bridge = createDirectUdpBridge(FakeSocket as unknown as DirectUdpSocketConstructor);
    expect(() => bridge.open('', 0, vi.fn(), vi.fn(), vi.fn())).toThrow('Invalid TSSHD UDP destination');
  });
});
