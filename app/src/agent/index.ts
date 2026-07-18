export { AgentControlService } from './AgentControlService';
export { AgentEventBus, type AgentEventListener, type AgentSubscription } from './AgentEventBus';
export { AGENT_METHODS, AGENT_PROTOCOL_VERSION } from './AgentProtocol';
export * from './protocol';
export { buildCapabilities } from './capabilities';
export { WorkspaceRegistry } from './WorkspaceRegistry';
export type {
  AgentCapabilities,
  AgentError,
  AgentErrorCode,
  AgentEvent,
  AgentEventType,
  AgentResult,
  PaneDirection,
  PaneHost,
  PaneInfo,
  SplitDirection,
  TabInfo,
  TabKind,
  WindowInfo,
} from './types';
export { agentErr, agentOk } from './types';
