import { describe, expect, it } from 'vitest';
import { joinCommand, parseArgv, parseFlags, requireFlag } from './args.ts';

describe('browser CLI parsing', () => {
  it('parses browser navigate with tab and url', () => {
    const parsed = parseArgv(['browser', 'navigate', '--tab', 'tab_1', 'https://example.com']);
    expect(parsed.command).toEqual(['browser', 'navigate']);
    const { flags, positional } = parseFlags(parsed.rest, { tab: 'string' });
    expect(requireFlag(flags, 'tab')).toBe('tab_1');
    expect(positional).toEqual(['https://example.com']);
  });

  it('parses browser navigate url after --', () => {
    const parsed = parseArgv(['browser', 'navigate', '--tab', 'tab_1', '--', 'https://example.com/path']);
    const { flags, passthrough } = parseFlags(parsed.rest, { tab: 'string' });
    expect(requireFlag(flags, 'tab')).toBe('tab_1');
    expect(passthrough).toEqual(['https://example.com/path']);
  });

  it('parses browser snapshot caps', () => {
    const parsed = parseArgv(['browser', 'snapshot', '--tab', 'tab_1', '--max-nodes', '50', '--max-bytes', '1024']);
    const { flags } = parseFlags(parsed.rest, { tab: 'string', 'max-nodes': 'number', 'max-bytes': 'number' });
    expect(flags.tab).toBe('tab_1');
    expect(flags['max-nodes']).toBe(50);
    expect(flags['max-bytes']).toBe(1024);
  });

  it('parses browser click and type refs', () => {
    const click = parseArgv(['browser', 'click', '--tab', 'tab_1', '--ref', 'e3']);
    const clickFlags = parseFlags(click.rest, { tab: 'string', ref: 'string' }).flags;
    expect(clickFlags.ref).toBe('e3');

    const typeCmd = parseArgv(['browser', 'type', '--tab', 'tab_1', '--ref', 'e2', '--', 'hello', 'world']);
    const { flags, passthrough } = parseFlags(typeCmd.rest, {
      tab: 'string',
      ref: 'string',
      text: 'string',
      'no-clear': 'boolean',
    });
    expect(flags.ref).toBe('e2');
    expect(joinCommand(passthrough)).toBe('hello world');
  });

  it('parses browser wait-for options', () => {
    const parsed = parseArgv([
      'browser',
      'wait-for',
      '--tab',
      'tab_1',
      '--selector',
      '#main',
      '--load-state',
      'idle',
      '--timeout-ms',
      '5000',
    ]);
    const { flags } = parseFlags(parsed.rest, {
      tab: 'string',
      selector: 'string',
      text: 'string',
      'load-state': 'string',
      'timeout-ms': 'number',
      'poll-interval-ms': 'number',
    });
    expect(flags.selector).toBe('#main');
    expect(flags['load-state']).toBe('idle');
    expect(flags['timeout-ms']).toBe(5000);
  });

  it('parses browser get-url and get-title commands', () => {
    expect(parseArgv(['browser', 'get-url', '--tab', 'tab_1']).command).toEqual(['browser', 'get-url']);
    expect(parseArgv(['browser', 'get-title', '--tab', 'tab_1']).command).toEqual(['browser', 'get-title']);
  });
});
