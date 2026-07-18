import type { AgentCapabilities } from './types';

const UNAVAILABLE_LATER = 'Not implemented in this build; tracked for a later control-plane slice.';

/** Report which AgentControlService methods are live vs stubbed. */
export function buildCapabilities(options?: {
  hasPaneHost?: boolean;
}): AgentCapabilities {
  const host = options?.hasPaneHost ?? true;
  const hostReason = host ? undefined : 'Pane host is not wired.';
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
      terminalRead: { available: false, reason: UNAVAILABLE_LATER },
      terminalRun: { available: false, reason: UNAVAILABLE_LATER },
      paneDiagnostics: { available: host, reason: hostReason },
      subscribe: { available: true },
    },
  };
}
