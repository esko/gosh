import {
  normalizeConnectionIntent,
  type ConnectionIntent,
  type ConnectionProtocol,
  type TsshdUdpMode,
} from './ConnectionIntent';

const SSH_FLAG_OPTIONS = '46AaCfGgKkMNnqsTtVvXxYy@';
const TSSHD_OPTIONS_WITH_VALUES = new Set(['--tsshd-path', '--tsshd-port']);

export type ParsedSshCommand = {
  destination: string | null;
  argstr: string;
};

export type ParsedSshDestination = {
  username: string;
  hostname: string;
  port: number | null;
};

function shellTokens(command: string): Array<{ value: string; raw: string; index: number }> {
  return [...command.matchAll(/(?:"[^"]*"|\S+)/g)].map((match) => ({
    value: match[0].replace(/(^"|"$)/g, ''),
    raw: match[0],
    index: match.index ?? 0,
  }));
}

export function parseCommand(
  command: string,
  optionsWithValues: ReadonlySet<string> = new Set(),
): ParsedSshCommand {
  const tokens = shellTokens(command);
  let skipNext = false;

  for (const token of tokens) {
    if (skipNext) {
      skipNext = false;
      continue;
    }

    const arg = token.value;
    if (optionsWithValues.has(arg)) {
      skipNext = true;
      continue;
    }
    if (!arg.startsWith('-')) {
      return {
        destination: arg,
        argstr: (command.slice(0, token.index) + command.slice(token.index + token.raw.length)).trim(),
      };
    }

    for (let index = 1; index < arg.length; index += 1) {
      if (SSH_FLAG_OPTIONS.includes(arg[index])) {
        continue;
      }
      skipNext = index === arg.length - 1;
      break;
    }
  }

  return {
    destination: null,
    argstr: command.trim(),
  };
}

export function parseSSHDestination(destination: string | null): ParsedSshDestination | null {
  if (!destination) {
    return null;
  }

  const sshUrlMatch = destination.match(/^ssh:\/\/(.+)@([^:@]+)(?::(\d+))?$/i);
  if (sshUrlMatch) {
    const [, username, hostname, port] = sshUrlMatch;
    return {
      username,
      hostname,
      port: port ? Number.parseInt(port, 10) : null,
    };
  }

  const match = destination.match(/^(.+)@([^@]+)$/);
  if (!match) {
    const hostname = destination.startsWith('[') && destination.endsWith(']')
      ? destination.slice(1, -1)
      : destination;
    return hostname.trim() ? { username: '', hostname, port: null } : null;
  }

  const [, username, rawHostname] = match;
  const hostname = rawHostname.startsWith('[') && rawHostname.endsWith(']')
    ? rawHostname.slice(1, -1)
    : rawHostname;

  return { username, hostname, port: null };
}

function extractPort(args: string): number | undefined {
  const tokens = shellTokens(args);
  for (let index = 0; index < tokens.length; index += 1) {
    const arg = tokens[index].value;
    if (arg === '-p') {
      const port = Number(tokens[index + 1]?.value);
      return Number.isFinite(port) ? port : undefined;
    }
    if (arg.startsWith('-p') && arg.length > 2) {
      const port = Number(arg.slice(2));
      return Number.isFinite(port) ? port : undefined;
    }
  }
  return undefined;
}

export function parseTerminalConnectionCommand(input: string): ConnectionIntent | null {
  const tokens = shellTokens(input.trim());
  const first = tokens[0]?.value.toLowerCase();
  let protocol: ConnectionProtocol = 'ssh';
  if (first === 'mosh') protocol = 'mosh';
  else if (first === 'et') protocol = 'et';
  else if (first === 'tssh') protocol = 'tsshd';
  const skipFirst = first === 'ssh' || first === 'mosh' || first === 'et' || first === 'tssh';
  const command = skipFirst
    ? input.slice((tokens[0]?.index ?? 0) + (tokens[0]?.raw.length ?? 0)).trim()
    : input.trim();

  const parsedCommand = parseCommand(
    command,
    protocol === 'tsshd' ? TSSHD_OPTIONS_WITH_VALUES : undefined,
  );
  const destination = parseSSHDestination(parsedCommand.destination);
  if (!destination) {
    return null;
  }

  const intent: ConnectionIntent = {
    protocol,
    username: destination.username,
    hostname: destination.hostname,
    port: extractPort(parsedCommand.argstr) ?? destination.port ?? undefined,
    args: shellTokens(parsedCommand.argstr).map((token) => token.value),
    argstr: parsedCommand.argstr || undefined,
    rawCommand: input,
  };

  if (protocol === 'tsshd') {
    const parsed = parseTsshdFlags(intent.args);
    if (!parsed) return null;
    intent.tsshd = parsed.options;
    intent.args = parsed.sshArgs;
    intent.argstr = parsed.sshArgs.length > 0 ? parsed.sshArgs.map(shellQuoteArgument).join(' ') : undefined;
  }

  return normalizeConnectionIntent(intent);
}

function shellQuoteArgument(value: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function parseTsshdFlags(args: string[]): {
  options: { udpMode?: TsshdUdpMode; tsshdPortRange?: string; tsshdPath?: string };
  sshArgs: string[];
} | null {
  const options: { udpMode?: TsshdUdpMode; tsshdPortRange?: string; tsshdPath?: string } = {};
  const sshArgs: string[] = [];
  const setMode = (mode: TsshdUdpMode): boolean => {
    if (options.udpMode && options.udpMode !== mode) return false;
    options.udpMode = mode;
    return true;
  };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--udp') {
      if (!setMode('QUIC')) return null;
    } else if (arg === '--kcp') {
      if (!setMode('KCP')) return null;
    } else if (arg === '--quic') {
      if (!setMode('QUIC')) return null;
    } else if (arg === '--tsshd-port' && i + 1 < args.length) {
      options.tsshdPortRange = args[++i];
    } else if (arg === '--tsshd-port') {
      return null;
    } else if (arg.startsWith('--tsshd-port=')) {
      options.tsshdPortRange = arg.slice('--tsshd-port='.length);
    } else if (arg === '--tsshd-path' && i + 1 < args.length) {
      options.tsshdPath = args[++i];
    } else if (arg === '--tsshd-path') {
      return null;
    } else if (arg.startsWith('--tsshd-path=')) {
      options.tsshdPath = arg.slice('--tsshd-path='.length);
    } else {
      sshArgs.push(arg);
    }
  }
  return { options, sshArgs };
}
