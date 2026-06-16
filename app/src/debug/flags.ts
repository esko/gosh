import { setVerboseLogging } from './logger';

export type DebugFlags = {
  debug: boolean;
  sshLogVerbose: boolean;
  termTrace: boolean;
};

let globalFlags: DebugFlags = {
  debug: false,
  sshLogVerbose: false,
  termTrace: false,
};

export function parseDebugFlags(search = window.location.search): DebugFlags {
  const q = new URLSearchParams(search);
  return {
    debug: q.get('debug') === '1' || q.get('debug') === 'true',
    sshLogVerbose: q.get('sshLog') === 'verbose',
    termTrace: q.get('termTrace') === '1' || q.get('termTrace') === 'true',
  };
}

export function applyDebugFlags(flags: DebugFlags): void {
  globalFlags = flags;
  setVerboseLogging(flags.sshLogVerbose || flags.debug);
}

export function getDebugFlags(): DebugFlags {
  return globalFlags;
}

export function initDebugFlagsFromUrl(): DebugFlags {
  const flags = parseDebugFlags();
  applyDebugFlags(flags);
  return flags;
}
