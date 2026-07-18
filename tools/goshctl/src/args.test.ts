import { describe, expect, it } from 'vitest';
import {
  joinCommand,
  parseArgv,
  parseFlags,
  readDataArg,
  requireFlag,
} from './args.ts';

describe('parseArgv', () => {
  it('parses global host/port and command segments', () => {
    const parsed = parseArgv(['--host', '10.0.0.1', '--port', '4242', 'workspace', 'list', '--json']);
    expect(parsed.global.host).toBe('10.0.0.1');
    expect(parsed.global.port).toBe(4242);
    expect(parsed.command).toEqual(['workspace', 'list']);
    expect(parsed.rest).toEqual(['--json']);
  });

  it('collects passthrough flags for subcommands', () => {
    const parsed = parseArgv(['terminal', 'run', '--pane', 'p1', '--', 'echo', 'hi']);
    expect(parsed.command).toEqual(['terminal', 'run']);
    expect(parsed.rest).toEqual(['--pane', 'p1', '--', 'echo', 'hi']);
  });
});

describe('parseFlags', () => {
  it('parses boolean and string flags before --', () => {
    const { flags, passthrough } = parseFlags(
      ['--pane', 'pane_1', '--json', '--', 'echo', 'hello'],
      { pane: 'string', json: 'boolean' },
    );
    expect(flags.pane).toBe('pane_1');
    expect(flags.json).toBe(true);
    expect(passthrough).toEqual(['echo', 'hello']);
  });

  it('rejects unknown flags', () => {
    expect(() => parseFlags(['--nope'], {})).toThrow(/Unknown flag/);
  });
});

describe('joinCommand', () => {
  it('joins argv into a single command string', () => {
    expect(joinCommand(['echo', 'hello', 'world'])).toBe('echo hello world');
  });
});

describe('readDataArg', () => {
  it('joins passthrough data', () => {
    expect(readDataArg({}, ['printf', 'x'])).toBe('printf x');
  });

  it('signals stdin when requested', () => {
    expect(() => readDataArg({ stdin: true }, [])).toThrow('STDIN_READ');
    expect(() => readDataArg({}, ['-'])).toThrow('STDIN_READ');
  });
});

describe('requireFlag', () => {
  it('returns required string flags', () => {
    expect(requireFlag({ pane: 'pane_abc' }, 'pane')).toBe('pane_abc');
  });
});
