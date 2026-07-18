import type { PaneDiagnostics } from './types';

export type Osc133DiagnosticInput = {
  phase: 'A' | 'B' | 'C' | 'D' | null;
  commandRunning: boolean;
  exitCode: number | null;
  lastMarkerAt: number | null;
};

/** Aggregate pane-local OSC 133 state for agent diagnostics. */
export function buildPaneDiagnostics(input: Osc133DiagnosticInput): PaneDiagnostics {
  const detected = input.lastMarkerAt !== null;
  const osc133: PaneDiagnostics['osc133'] = {
    detected,
    phase: input.phase,
    commandRunning: input.commandRunning,
    exitCode: input.exitCode,
  };
  if (input.lastMarkerAt !== null) osc133.lastMarkerAt = input.lastMarkerAt;
  return { osc133 };
}
