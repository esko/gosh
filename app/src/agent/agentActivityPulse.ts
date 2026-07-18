/** Brief flash after `terminal.send`; sustained while `terminal.run` is pending. */
export const AGENT_ACTIVITY_PULSE_MS = 1500;

export type AgentPaneActivityState = {
  pulseUntilMs: number;
  runPending: boolean;
};

export const EMPTY_AGENT_PANE_ACTIVITY: AgentPaneActivityState = {
  pulseUntilMs: 0,
  runPending: false,
};

export type AgentActivityAction = 'send' | 'run-start' | 'run-end';

export function reduceAgentPaneActivity(
  state: AgentPaneActivityState,
  action: AgentActivityAction,
  nowMs: number,
  pulseMs = AGENT_ACTIVITY_PULSE_MS,
): AgentPaneActivityState {
  switch (action) {
    case 'send':
      return { ...state, pulseUntilMs: Math.max(state.pulseUntilMs, nowMs + pulseMs) };
    case 'run-start':
      return {
        ...state,
        runPending: true,
        pulseUntilMs: Math.max(state.pulseUntilMs, nowMs + pulseMs),
      };
    case 'run-end':
      return { ...state, runPending: false };
    default: {
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}

export function isAgentPaneActive(state: AgentPaneActivityState, nowMs: number): boolean {
  return state.runPending || nowMs < state.pulseUntilMs;
}
