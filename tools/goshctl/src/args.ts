export type ParsedArgv = {
  global: {
    host?: string;
    port?: number;
    help?: boolean;
  };
  command: string[];
  rest: string[];
};

export function parseArgv(argv: string[]): ParsedArgv {
  const global: ParsedArgv['global'] = {};
  const command: string[] = [];
  const rest: string[] = [];
  let i = 0;

  while (i < argv.length) {
    const arg = argv[i]!;
    if (arg === '--help' || arg === '-h') {
      global.help = true;
      i += 1;
      continue;
    }
    if (arg === '--host') {
      global.host = argv[i + 1];
      if (!global.host) throw new Error('--host requires a value');
      i += 2;
      continue;
    }
    if (arg === '--port') {
      const raw = argv[i + 1];
      if (!raw) throw new Error('--port requires a value');
      const port = Number(raw);
      if (!Number.isInteger(port) || port < 1 || port > 65_535) {
        throw new Error(`Invalid --port: ${raw}`);
      }
      global.port = port;
      i += 2;
      continue;
    }
    if (arg.startsWith('-')) {
      rest.push(arg, ...argv.slice(i + 1));
      break;
    }
    command.push(arg);
    i += 1;
    if (command.length >= 3) {
      rest.push(...argv.slice(i));
      break;
    }
  }

  return { global, command, rest };
}

export type FlagSpec = Record<string, 'boolean' | 'string' | 'number'>;

export type ParsedFlags = {
  positional: string[];
  flags: Record<string, string | number | boolean>;
  passthrough: string[];
};

export function parseFlags(args: string[], spec: FlagSpec): ParsedFlags {
  const flags: Record<string, string | number | boolean> = {};
  const positional: string[] = [];
  const passthrough: string[] = [];
  let i = 0;

  while (i < args.length) {
    const arg = args[i]!;
    if (arg === '--') {
      passthrough.push(...args.slice(i + 1));
      break;
    }
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const kind = spec[key];
      if (!kind) throw new Error(`Unknown flag: --${key}`);
      if (kind === 'boolean') {
        flags[key] = true;
        i += 1;
        continue;
      }
      const value = args[i + 1];
      if (value === undefined) throw new Error(`--${key} requires a value`);
      if (kind === 'number') {
        const num = Number(value);
        if (!Number.isFinite(num)) throw new Error(`--${key} must be a number`);
        flags[key] = num;
      } else {
        flags[key] = value;
      }
      i += 2;
      continue;
    }
    positional.push(arg);
    i += 1;
  }

  return { positional, flags, passthrough };
}

export function requireFlag(flags: Record<string, string | number | boolean>, name: string): string {
  const value = flags[name];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`--${name} is required`);
  }
  return value;
}

export function joinCommand(argv: string[]): string {
  if (argv.length === 0) throw new Error('command is required after --');
  return argv.join(' ');
}

export function readDataArg(flags: Record<string, string | number | boolean>, passthrough: string[]): string {
  if (flags.stdin === true || passthrough[0] === '-') {
    throw new Error('STDIN_READ');
  }
  if (passthrough.length === 0) throw new Error('data is required after -- (or use --stdin / -)');
  return passthrough.join(' ');
}
