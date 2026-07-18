import { describe, expect, it } from 'vitest';
import {
  AGENT_ACTIVITY_PULSE_MS,
  EMPTY_AGENT_PANE_ACTIVITY,
  isAgentPaneActive,
  reduceAgentPaneActivity,
} from './agentActivityPulse';

describe('agentActivityPulse', () => {
  const t0 = 10_000;

  it('extends pulse window on send', () => {
    const after = reduceAgentPaneActivity(EMPTY_AGENT_PANE_ACTIVITY, 'send', t0);
    expect(after.pulseUntilMs).toBe(t0 + AGENT_ACTIVITY_PULSE_MS);
    expect(isAgentPaneActive(after, t0)).toBe(true);
    expect(isAgentPaneActive(after, t0 + AGENT_ACTIVITY_PULSE_MS - 1)).toBe(true);
    expect(isAgentPaneActive(after, t0 + AGENT_ACTIVITY_PULSE_MS)).toBe(false);
  });

  it('keeps pane active while a run is pending', () => {
    let state = reduceAgentPaneActivity(EMPTY_AGENT_PANE_ACTIVITY, 'run-start', t0);
    expect(isAgentPaneActive(state, t0 + AGENT_ACTIVITY_PULSE_MS + 500)).toBe(true);
    state = reduceAgentPaneActivity(state, 'run-end', t0 + AGENT_ACTIVITY_PULSE_MS + 500);
    expect(state.runPending).toBe(false);
    expect(isAgentPaneActive(state, t0 + AGENT_ACTIVITY_PULSE_MS + 500)).toBe(false);
  });

  it('extends an existing pulse when sends overlap', () => {
    const first = reduceAgentPaneActivity(EMPTY_AGENT_PANE_ACTIVITY, 'send', t0);
    const second = reduceAgentPaneActivity(first, 'send', t0 + 500);
    expect(second.pulseUntilMs).toBe(t0 + 500 + AGENT_ACTIVITY_PULSE_MS);
  });
});
