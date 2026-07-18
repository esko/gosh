import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

export const DEFAULT_GOSH_HOST = '127.0.0.1';
export const GOSH_CONFIG_DIR = path.join(homedir(), '.config', 'gosh');
export const DEFAULT_TOKEN_PATH = path.join(GOSH_CONFIG_DIR, 'token');
export const DEFAULT_PORT_PATH = path.join(GOSH_CONFIG_DIR, 'port');

function readConfigFile(filePath) {
  try {
    return readFileSync(filePath, 'utf8').trim();
  } catch {
    return null;
  }
}

function firstEnv(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (value !== undefined && value !== '') return value;
  }
  return null;
}

function resolvePort() {
  const fromEnv = firstEnv('GOSH_PORT', 'GOSH_AGENT_PORT', 'GOSH_CONTROL_PORT');
  if (fromEnv !== null) {
    const port = Number(fromEnv);
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      throw new Error(`Invalid port env: ${fromEnv}`);
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

function resolveToken() {
  const fromEnv = firstEnv('GOSH_TOKEN', 'GOSH_AGENT_TOKEN', 'GOSH_CONTROL_TOKEN');
  if (fromEnv) return fromEnv.trim();
  const fromFile = readConfigFile(DEFAULT_TOKEN_PATH);
  if (fromFile) return fromFile;
  return null;
}

export function loadAgentControlConfig(overrides = {}) {
  const host =
    overrides.host ??
    firstEnv('GOSH_HOST', 'GOSH_AGENT_HOST', 'GOSH_CONTROL_HOST') ??
    DEFAULT_GOSH_HOST;
  const port = overrides.port ?? resolvePort();
  const token = overrides.token ?? resolveToken();
  return { host, port, token };
}

export function requirePort(config) {
  if (config.port === null) {
    throw new Error(
      'Missing control server port: set GOSH_PORT (or GOSH_AGENT_PORT) or write ~/.config/gosh/port from Gosh Settings → Security.',
    );
  }
  return config.port;
}

export function requireToken(config) {
  if (!config.token) {
    throw new Error(
      `Missing pairing token: set GOSH_TOKEN (or GOSH_AGENT_TOKEN) or write ${DEFAULT_TOKEN_PATH} (chmod 600).`,
    );
  }
  return config.token;
}
