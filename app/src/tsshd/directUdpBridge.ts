type UdpMessage = { data: ArrayBuffer | ArrayBufferView };

export type DirectUdpSocket = {
  opened: Promise<{
    readable: ReadableStream<UdpMessage>;
    writable: WritableStream<{ data: ArrayBuffer; remoteAddress?: string; remotePort?: number }>;
  }>;
  closed: Promise<void>;
  close(): Promise<void>;
};

export type DirectUdpSocketConstructor = new (options: {
  remoteAddress: string;
  remotePort: number;
}) => DirectUdpSocket;

export type DirectUdpBridge = {
  open(
    host: string,
    port: number,
    onPacket: (data: Uint8Array) => void,
    onError: (message: string) => void,
    onOpened: (message?: string) => void,
  ): {
    send(data: Uint8Array, onDone: (message?: string) => void): void;
    close(onClosed: () => void): void;
  };
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function packetBytes(value: UdpMessage | undefined): Uint8Array | null {
  const data = value?.data;
  if (data instanceof ArrayBuffer) return data.byteLength <= 0xffff ? new Uint8Array(data) : null;
  if (ArrayBuffer.isView(data)) {
    if (data.byteLength > 0xffff) return null;
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  return null;
}

export function createDirectUdpBridge(UDPSocket: DirectUdpSocketConstructor | undefined): DirectUdpBridge {
  return {
    open(host, port, onPacket, onError, onOpened) {
      if (typeof UDPSocket !== 'function') throw new Error('Direct Sockets (UDPSocket) is unavailable in the TSSHD worker.');
      if (!host || !Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('Invalid TSSHD UDP destination.');

      const socket = new UDPSocket({ remoteAddress: host, remotePort: port });
      let reader: ReadableStreamDefaultReader<UdpMessage> | null = null;
      let writer: WritableStreamDefaultWriter<{ data: ArrayBuffer; remoteAddress?: string; remotePort?: number }> | null = null;
      let closed = false;
      let openedSettled = false;
      let sendChain = Promise.resolve();

      const opened = socket.opened.then(({ readable, writable }) => {
        if (closed) throw new Error('TSSHD UDP socket closed during startup.');
        reader = readable.getReader();
        writer = writable.getWriter();
        openedSettled = true;
        onOpened();
        void (async () => {
          try {
            while (!closed && reader) {
              const { value, done } = await reader.read();
              if (done) break;
              const bytes = packetBytes(value);
              if (bytes) onPacket(new Uint8Array(bytes));
            }
          } catch (error) {
            if (!closed) onError(errorMessage(error));
          }
        })();
      });
      void opened.catch((error) => {
        if (!closed) {
          const message = errorMessage(error);
          if (!openedSettled) onOpened(message);
          onError(message);
        }
      });
      void socket.closed.catch((error) => {
        if (!closed) onError(errorMessage(error));
      });

      return {
        send(data, onDone) {
          if (closed) {
            onDone('TSSHD UDP socket is closed.');
            return;
          }
          const copy = new Uint8Array(data);
          sendChain = sendChain.catch(() => undefined).then(async () => {
            await opened;
            if (closed || !writer) throw new Error('TSSHD UDP socket is closed.');
            await writer.ready;
            await writer.write({ data: copy.buffer });
          });
          void sendChain.then(
            () => onDone(),
            (error) => {
              const message = errorMessage(error);
              onDone(message);
              if (!closed) onError(message);
            },
          );
        },
        close(onClosed) {
          if (closed) {
            onClosed();
            return;
          }
          closed = true;
          void (async () => {
            if (reader) {
              await reader.cancel('TSSHD relay closed').catch(() => undefined);
              reader.releaseLock();
              reader = null;
            }
            if (writer) {
              await writer.abort('TSSHD relay closed').catch(() => undefined);
              writer.releaseLock();
              writer = null;
            }
            await socket.close().catch(() => undefined);
          })().finally(onClosed);
        },
      };
    },
  };
}
