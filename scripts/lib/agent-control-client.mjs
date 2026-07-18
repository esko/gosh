import { connect } from 'node:net';
import {
  AUTH_METHOD,
  decodeFrames,
  encodeFrame,
  isJsonRpcErrorResponse,
} from './agent-control-protocol.mjs';

export class AgentControlProbeClient {
  constructor({ host, port, token }) {
    this.host = host;
    this.port = port;
    this.token = token;
    this.socket = null;
    this.buffer = '';
    this.nextId = 1;
    this.pending = new Map();
    this.dataListener = null;
  }

  async open({ authenticate = true } = {}) {
    if (this.socket) return;
    const socket = connect({ host: this.host, port: this.port });
    await new Promise((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('error', reject);
    });
    this.attachSocket(socket);
    if (authenticate) {
      await this.authenticate();
    }
  }

  attachSocket(socket) {
    this.socket = socket;
    this.dataListener = (chunk) => {
      this.buffer += chunk.toString('utf8');
      const { decoded, errors, remainder } = decodeFrames(this.buffer);
      this.buffer = remainder;
      if (errors.length > 0) {
        const message = errors.map((err) => err.message).join('; ');
        for (const pending of this.pending.values()) pending.reject(new Error(message));
        this.pending.clear();
      }
      for (const frame of decoded) {
        const value = frame.value;
        if (typeof value !== 'object' || value === null || !('id' in value)) continue;
        const pending = this.pending.get(value.id);
        if (!pending) continue;
        this.pending.delete(value.id);
        pending.resolve(value);
      }
    };
    socket.on('data', this.dataListener);
    socket.on('error', (error) => {
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
    });
    socket.on('close', () => {
      for (const pending of this.pending.values()) pending.reject(new Error('Connection closed'));
      this.pending.clear();
    });
  }

  async authenticate(token = this.token) {
    return this.request(AUTH_METHOD, { token });
  }

  async request(method, params) {
    if (!this.socket) throw new Error('Client is not connected');
    const id = this.nextId++;
    const request = { jsonrpc: '2.0', method, params, id };
    const response = await new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        this.socket.write(encodeFrame(request));
      } catch (error) {
        this.pending.delete(id);
        reject(error);
      }
    });
    if (isJsonRpcErrorResponse(response)) {
      const error = new Error(response.error.message);
      error.code = response.error.code;
      error.data = response.error.data;
      throw error;
    }
    return response.result;
  }

  writeRaw(text) {
    if (!this.socket) throw new Error('Client is not connected');
    this.socket.write(text);
  }

  close() {
    if (this.socket && this.dataListener) {
      this.socket.removeListener('data', this.dataListener);
    }
    this.socket?.end();
    this.socket = null;
    this.pending.clear();
  }
}

export function connectRaw({ host, port }) {
  return new Promise((resolve, reject) => {
    const socket = connect({ host, port });
    socket.once('connect', () => resolve(socket));
    socket.once('error', reject);
  });
}

export async function readOneResponse(socket, timeoutMs = 5000) {
  let buffer = '';
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for response'));
    }, timeoutMs);

    const onData = (chunk) => {
      buffer += chunk.toString('utf8');
      const { decoded, remainder } = decodeFrames(buffer);
      buffer = remainder;
      if (decoded.length > 0) {
        cleanup();
        resolve(decoded[0].value);
      }
    };

    const onClose = () => {
      cleanup();
      reject(new Error('Connection closed before response'));
    };

    const onError = (error) => {
      cleanup();
      reject(error);
    };

    const cleanup = () => {
      clearTimeout(timer);
      socket.removeListener('data', onData);
      socket.removeListener('close', onClose);
      socket.removeListener('error', onError);
    };

    socket.on('data', onData);
    socket.once('close', onClose);
    socket.once('error', onError);
  });
}
