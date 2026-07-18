import type { AgentCapabilities } from './types';

/** Report which AgentControlService methods are live vs stubbed. */
export function buildCapabilities(options?: {
  hasPaneHost?: boolean;
  hasTerminalRead?: boolean;
  hasTerminalRun?: boolean;
  hasBrowserHost?: boolean;
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
  const browser = options?.hasBrowserHost ?? false;
  const browserReason = browser ? undefined : 'Browser host is not wired.';
  const browserCap = { available: browser, reason: browserReason };
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
      browserNavigate: browserCap,
      browserBack: browserCap,
      browserForward: browserCap,
      browserReload: browserCap,
      browserWaitFor: browserCap,
      browserSnapshot: browserCap,
      browserQuery: browserCap,
      browserClick: browserCap,
      browserType: browserCap,
      browserPress: browserCap,
      browserGetUrl: browserCap,
      browserGetTitle: browserCap,
      browserHandleDialog: browserCap,
      browserHandleNewWindow: browserCap,
      subscribe: { available: true },
    },
  };
}
