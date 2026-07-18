import { describe, expect, it } from 'vitest';
import {
  AGENT_PAYLOAD_TOO_LARGE,
  RPC_METHOD_NOT_FOUND,
  RPC_PARSE_ERROR,
} from './errors';
import {
  DEFAULT_MAX_FRAME_BYTES,
  FrameTooLargeError,
  decodeFrame,
  decodeFrames,
  encodeFrame,
  splitNdjsonLines,
} from './framing';
import { JSONRPC_VERSION } from './types';
import { validateRequest } from './validate';

describe('NDJSON framing', () => {
  it('round-trips a request frame', () => {
    const request = {
      jsonrpc: JSONRPC_VERSION,
      method: 'workspace.listTabs',
      id: 1,
    };
    const line = encodeFrame(request);
    expect(line.endsWith('\n')).toBe(true);
    const decoded = decodeFrame(line);
    expect(decoded).toEqual({ ok: true, value: request, bytes: line.trimEnd().length });
  });

  it('round-trips multiple frames from a buffer', () => {
    const a = encodeFrame({ jsonrpc: JSONRPC_VERSION, method: 'gosh.capabilities', id: 'a' });
    const b = encodeFrame({ jsonrpc: JSONRPC_VERSION, method: 'workspace.listWindows', id: 2 });
    const { decoded, errors, remainder } = decodeFrames(a + b);
    expect(errors).toEqual([]);
    expect(remainder).toBe('');
    expect(decoded).toHaveLength(2);
    expect(decoded[0]?.value).toMatchObject({ id: 'a' });
    expect(decoded[1]?.value).toMatchObject({ id: 2 });
  });

  it('keeps partial lines in the remainder', () => {
    const complete = encodeFrame({ jsonrpc: JSONRPC_VERSION, method: 'workspace.listTabs', id: 1 });
    const partial = '{"jsonrpc":"2.0","method":"workspace.listPanes"';
    const { lines, remainder } = splitNdjsonLines(complete + partial);
    expect(lines).toHaveLength(1);
    expect(remainder).toBe(partial);
  });

  it('rejects oversized frames on encode', () => {
    const huge = 'x'.repeat(DEFAULT_MAX_FRAME_BYTES);
    expect(() => encodeFrame({ data: huge }, 64)).toThrow(FrameTooLargeError);
  });

  it('rejects oversized frames on decode', () => {
    const line = `${'a'.repeat(128)}\n`;
    const result = decodeFrame(line, 64);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(AGENT_PAYLOAD_TOO_LARGE);
    }
  });

  it('reports invalid JSON lines', () => {
    const result = decodeFrame('{not json}\n');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(RPC_PARSE_ERROR);
      expect(result.message).toBe('Invalid JSON');
    }
  });

  it('rejects empty lines', () => {
    const result = decodeFrame('\n');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBe('Empty frame');
  });
});

describe('validateRequest', () => {
  it('accepts a well-formed capabilities request', () => {
    const result = validateRequest({
      jsonrpc: JSONRPC_VERSION,
      method: 'gosh.capabilities',
      params: { protocolVersion: 1 },
      id: 1,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.params).toEqual({ protocolVersion: 1 });
    }
  });

  it('rejects unknown methods', () => {
    const result = validateRequest({
      jsonrpc: JSONRPC_VERSION,
      method: 'workspace.destroyEverything',
      id: 9,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.error.code).toBe(RPC_METHOD_NOT_FOUND);
      expect(result.response.id).toBe(9);
    }
  });

  it('rejects bad param types', () => {
    const result = validateRequest({
      jsonrpc: JSONRPC_VERSION,
      method: 'pane.focus',
      params: { paneId: 42 },
      id: 'x',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.error.message).toContain('paneId');
    }
  });
});
