import type { AgentCapabilities } from './types';

/** Report which AgentControlService methods are live vs stubbed. */
export function buildCapabilities(options?: {
  hasPaneHost?: boolean;
  hasTerminalRead?: boolean;
  hasTerminalRun?: boolean;
}): AgentCapabilities {
  const host = options?.hasPaneHost ?? true;
  const hostReason = host ? undefined : 'Pane host is not wired.';
  const terminalRead = host && (options?.hasTerminalRead ?? true);
  const terminalReadReason = terminalRead
    ? undefined
    : host
      ? 'Terminal read is not wired in this build.'
      : hostReason;
  const terminalRun = host && terminalRead && (options?.hasTerminalRun ?? true);
  const terminalRunReason = terminalRun
    ? undefined
    : !host
      ? hostReason
      : !terminalRead
        ? terminalReadReason
        : 'terminalRun is not wired in this build.';
  return {
    methods: {
      capabilities: { available: true },
      listWindows: { available: true },
      listTabs: { available: true },
      listPanes: { available: true },
      paneSplit: { available: host, reason: hostReason },
      paneFocus: { available: host, reason: hostReason },
      paneResize: { available: host, reason: hostReason },
      paneZoom: { available: host, reason: hostReason },
      paneClose: { available: host, reason: hostReason },
      terminalSend: { available: host, reason: hostReason },
      terminalRead: { available: terminalRead, reason: terminalReadReason },
      terminalRun: { available: terminalRun, reason: terminalRunReason },
      paneDiagnostics: { available: host, reason: hostReason },
      subscribe: { available: true },
    },
  };
}
