import { describe, expect, it } from 'vitest';
import { buildPaneDiagnostics } from './paneDiagnostics';

describe('buildPaneDiagnostics', () => {
  it('reports not detected before any marker', () => {
    expect(
      buildPaneDiagnostics({
        phase: null,
        commandRunning: false,
        exitCode: null,
        lastMarkerAt: null,
      }),
    ).toEqual({
      osc133: {
        detected: false,
        phase: null,
        commandRunning: false,
        exitCode: null,
      },
    });
  });

  it('reports detected with phase, running state, and lastMarkerAt', () => {
    expect(
      buildPaneDiagnostics({
        phase: 'D',
        commandRunning: false,
        exitCode: 2,
        lastMarkerAt: 1_700_000_000_200,
      }),
    ).toEqual({
      osc133: {
        detected: true,
        phase: 'D',
        lastMarkerAt: 1_700_000_000_200,
        commandRunning: false,
        exitCode: 2,
      },
    });
  });
});
