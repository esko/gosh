export { AgentControlService } from './AgentControlService';
export { AgentEventBus, type AgentEventListener, type AgentSubscription } from './AgentEventBus';
export { CommandTracker, type CommandRecord, type Osc133FeedEvent } from './CommandTracker';
export { AGENT_METHODS, AGENT_PROTOCOL_VERSION } from './AgentProtocol';
export * from './protocol';
export { buildCapabilities } from './capabilities';
export { buildPaneDiagnostics } from './paneDiagnostics';
export { WorkspaceRegistry } from './WorkspaceRegistry';
export type {
  AgentCapabilities,
  AgentError,
  AgentErrorCode,
  AgentEvent,
  AgentEventType,
  AgentResult,
  PaneDirection,
  PaneDiagnostics,
  PaneHost,
  BrowserHost,
  PaneInfo,
  SplitDirection,
  TabInfo,
  TabKind,
  TerminalPosition,
  TerminalReadResult,
  TerminalRunCompletion,
  TerminalRunResult,
  TerminalTextCapture,
  WindowInfo,
} from './types';
export { agentErr, agentOk } from './types';
