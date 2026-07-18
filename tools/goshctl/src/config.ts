import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

/** Loopback bind address per ADR 0013 / docs/agent/PROTOCOL.md */
export const DEFAULT_GOSH_HOST = '127.0.0.1';

export const GOSH_CONFIG_DIR = path.join(homedir(), '.config', 'gosh');
export const DEFAULT_TOKEN_PATH = path.join(GOSH_CONFIG_DIR, 'token');
export const DEFAULT_PORT_PATH = path.join(GOSH_CONFIG_DIR, 'port');

export type GoshClientConfig = {
  host: string;
  port: number;
  token: string;
};

function readConfigFile(filePath: string): string | null {
  try {
    return readFileSync(filePath, 'utf8').trim();
  } catch {
    return null;
  }
}

function resolvePort(): number | null {
  const fromEnv = process.env.GOSH_PORT;
  if (fromEnv !== undefined && fromEnv !== '') {
    const port = Number(fromEnv);
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      throw new Error(`Invalid GOSH_PORT: ${fromEnv}`);
    }
    return port;
  }
  const fromFile = readConfigFile(DEFAULT_PORT_PATH);
  if (fromFile) {
    const port = Number(fromFile);
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      throw new Error(`Invalid port in ${DEFAULT_PORT_PATH}: ${fromFile}`);
    }
    return port;
  }
  return null;
}

function resolveToken(): string | null {
  const fromEnv = process.env.GOSH_TOKEN;
  if (fromEnv) return fromEnv.trim();
  const fromFile = readConfigFile(DEFAULT_TOKEN_PATH);
  if (fromFile) return fromFile;
  return null;
}

export function loadClientConfig(overrides?: { host?: string; port?: number; token?: string }): GoshClientConfig {
  const host = overrides?.host ?? process.env.GOSH_HOST ?? DEFAULT_GOSH_HOST;
  const port = overrides?.port ?? resolvePort();
  const token = overrides?.token ?? resolveToken();

  if (port === null) {
    throw new Error(
      'Missing control server port: set GOSH_PORT or write the listen port to ~/.config/gosh/port (shown in Gosh Settings → Security when agent control is on).',
    );
  }
  if (!token) {
    throw new Error(
      `Missing pairing token: set GOSH_TOKEN or write the token to ${DEFAULT_TOKEN_PATH} (chmod 600). Copy it from Gosh Settings → Security.`,
    );
  }
  return { host, port, token };
}
