import { stdin } from 'node:process';
import { loadClientConfig } from './config.ts';
import { AGENT_EVENT_NOTIFICATION, GoshControlClient, type CallError } from './client.ts';
import {
  joinCommand,
  parseArgv,
  parseFlags,
  readDataArg,
  requireFlag,
  type ParsedArgv,
} from './args.ts';
import { EXIT_PROTOCOL, EXIT_RPC } from './exitCodes.ts';
import type { AgentRpcParams, PaneInfo } from './protocol.ts';

const HELP = `goshctl — Gosh agent control client (NDJSON JSON-RPC over loopback)

Usage:
  goshctl [global flags] <command> ...

Global flags:
  --host <addr>   Override GOSH_HOST (default 127.0.0.1)
  --port <port>   Override GOSH_PORT or ~/.config/gosh/port
  -h, --help      Show help

Commands:
  capabilities
  workspace list [--json]
  pane list [--json] [--tab <tabId>]
  terminal read --pane <id> [--json]
  terminal send --pane <id> [--stdin] [--] <data...>
  terminal run --pane <id> [--json] [--] <command...>
  pane split --pane <id> (--right | --down)
  pane resize --pane <id> (--right | --left | --up | --down) [--amount N]
  pane focus --pane <id>
  pane zoom --pane <id>
  pane close --pane <id>
  browser navigate --tab <id> <url>
  browser back --tab <id>
  browser forward --tab <id>
  browser reload --tab <id>
  browser snapshot --tab <id> [--max-nodes N] [--max-bytes N]
  browser query --tab <id> [--role R] [--name N] [--text T] [--selector S]
  browser wait-for --tab <id> [--selector S] [--text T] [--load-state load|idle]
  browser click --tab <id> --ref <ref>
  browser type --tab <id> --ref <ref> [--no-clear] [--] <text...>
  browser press --tab <id> --ref <ref> --key <key>
  browser get-url --tab <id>
  browser get-title --tab <id>
  events [--json]

Credentials:
  GOSH_TOKEN or ~/.config/gosh/token (chmod 600)
  GOSH_PORT or ~/.config/gosh/port (ephemeral port from Settings → Security)

Exit codes:
  0 success
  1 protocol / connection / usage error
  2 remote JSON-RPC error
  terminal run also exits with remote exitCode on success
`;

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function printError(message: string): void {
  process.stderr.write(`${message}\n`);
}

function isCallError(error: unknown): error is CallError {
  return typeof error === 'object' && error !== null && 'kind' in error;
}

function handleError(error: unknown): never {
  if (isCallError(error)) {
    if (error.kind === 'rpc') {
      printError(`${error.message} (code ${error.code})`);
      process.exit(EXIT_RPC);
    }
    printError(error.message);
    process.exit(EXIT_PROTOCOL);
  }
  if (error instanceof Error) {
    printError(error.message);
    process.exit(EXIT_PROTOCOL);
  }
  printError(String(error));
  process.exit(EXIT_PROTOCOL);
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stdin) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function withClient<T>(
  parsed: ParsedArgv,
  run: (client: GoshControlClient) => Promise<T>,
): Promise<T> {
  const config = loadClientConfig({
    host: parsed.global.host,
    port: parsed.global.port,
  });
  const client = new GoshControlClient(config);
  try {
    await client.open();
    return await run(client);
  } finally {
    client.close();
  }
}

async function tabIdForPane(client: GoshControlClient, paneId: string): Promise<string> {
  const panes = (await client.call('workspace.listPanes', {})) as PaneInfo[];
  const pane = panes.find((entry) => entry.paneId === paneId);
  if (!pane) throw { kind: 'rpc', code: -32602, message: `Unknown pane: ${paneId}` } as const;
  return pane.tabId;
}

async function runCommand(parsed: ParsedArgv): Promise<number> {
  const [group, action] = parsed.command;

  if (!group || parsed.global.help) {
    process.stdout.write(HELP);
    return 0;
  }

  if (group === 'capabilities') {
    const result = await withClient(parsed, (client) => client.call('gosh.capabilities', {}));
    printJson(result);
    return 0;
  }

  if (group === 'workspace' && action === 'list') {
    parseFlags(parsed.rest, { json: 'boolean' });
    const result = await withClient(parsed, async (client) => {
      const [windows, tabs] = await Promise.all([
        client.call('workspace.listWindows', {}),
        client.call('workspace.listTabs', {}),
      ]);
      return { windows, tabs };
    });
    printJson(result);
    return 0;
  }

  if (group === 'pane' && action === 'list') {
    const { flags } = parseFlags(parsed.rest, { json: 'boolean', tab: 'string' });
    const params: AgentRpcParams['workspace.listPanes'] = {};
    if (typeof flags.tab === 'string') params.tabId = flags.tab;
    const result = await withClient(parsed, (client) => client.call('workspace.listPanes', params));
    printJson(result);
    return 0;
  }

  if (group === 'terminal') {
    if (action === 'read') {
      const { flags } = parseFlags(parsed.rest, { pane: 'string', json: 'boolean' });
      const paneId = requireFlag(flags, 'pane');
      const result = await withClient(parsed, (client) =>
        client.call('terminal.read', { paneId } satisfies AgentRpcParams['terminal.read']),
      );
      if (flags.json) {
        printJson(result);
      } else {
        const text = (result as { text?: string }).text ?? '';
        process.stdout.write(text);
        if (!text.endsWith('\n') && text.length > 0) process.stdout.write('\n');
      }
      return 0;
    }

    if (action === 'send') {
      const { flags, passthrough } = parseFlags(parsed.rest, { pane: 'string', stdin: 'boolean' });
      const paneId = requireFlag(flags, 'pane');
      let data: string;
      try {
        data = readDataArg(flags, passthrough);
      } catch (error) {
        if (error instanceof Error && error.message === 'STDIN_READ') {
          data = await readStdin();
        } else {
          throw error;
        }
      }
      const result = await withClient(parsed, (client) =>
        client.call('terminal.send', { paneId, data } satisfies AgentRpcParams['terminal.send']),
      );
      printJson(result);
      return 0;
    }

    if (action === 'run') {
      const { flags, passthrough } = parseFlags(parsed.rest, { pane: 'string', json: 'boolean' });
      const paneId = requireFlag(flags, 'pane');
      const command = joinCommand(passthrough);
      const result = await withClient(parsed, (client) =>
        client.call('terminal.run', { paneId, command } satisfies AgentRpcParams['terminal.run']),
      );
      if (flags.json) {
        printJson(result);
      } else {
        const output = (result as { output?: string }).output ?? '';
        process.stdout.write(output);
        if (!output.endsWith('\n') && output.length > 0) process.stdout.write('\n');
      }
      const exitCode = (result as { exitCode?: number | null }).exitCode;
      return typeof exitCode === 'number' ? exitCode : 1;
    }
  }

  if (group === 'pane') {
    if (action === 'split') {
      const { flags } = parseFlags(parsed.rest, {
        pane: 'string',
        right: 'boolean',
        down: 'boolean',
      });
      const paneId = requireFlag(flags, 'pane');
      const direction = flags.right ? 'vertical' : flags.down ? 'horizontal' : null;
      if (!direction) throw new Error('pane split requires --right or --down');
      const result = await withClient(parsed, async (client) => {
        const tabId = await tabIdForPane(client, paneId);
        return client.call('pane.split', { tabId, direction } satisfies AgentRpcParams['pane.split']);
      });
      printJson(result);
      return 0;
    }

    if (action === 'resize') {
      const { flags } = parseFlags(parsed.rest, {
        pane: 'string',
        right: 'boolean',
        left: 'boolean',
        up: 'boolean',
        down: 'boolean',
        amount: 'number',
      });
      const paneId = requireFlag(flags, 'pane');
      const direction =
        (flags.right && 'right') ||
        (flags.left && 'left') ||
        (flags.up && 'up') ||
        (flags.down && 'down') ||
        null;
      if (!direction) throw new Error('pane resize requires --right, --left, --up, or --down');
      const params: AgentRpcParams['pane.resize'] = { paneId, direction };
      if (typeof flags.amount === 'number') params.amount = flags.amount;
      const result = await withClient(parsed, (client) => client.call('pane.resize', params));
      printJson(result);
      return 0;
    }

    if (action === 'focus' || action === 'zoom' || action === 'close') {
      const { flags } = parseFlags(parsed.rest, { pane: 'string' });
      const paneId = requireFlag(flags, 'pane');
      const method =
        action === 'focus' ? 'pane.focus' : action === 'zoom' ? 'pane.zoom' : 'pane.close';
      const result = await withClient(parsed, (client) =>
        client.call(method, { paneId } as AgentRpcParams['pane.focus']),
      );
      printJson(result);
      return 0;
    }
  }

  if (group === 'browser') {
    const tabId = () => requireFlag(parseFlags(parsed.rest, { tab: 'string' }).flags, 'tab');

    if (action === 'navigate') {
      const { flags, positional, passthrough } = parseFlags(parsed.rest, { tab: 'string' });
      const id = requireFlag(flags, 'tab');
      const url = passthrough[0] ?? positional[0];
      if (!url) throw new Error('url is required (positional or after --)');
      const result = await withClient(parsed, (client) =>
        client.call('browser.navigate', { tabId: id, url } satisfies AgentRpcParams['browser.navigate']),
      );
      printJson(result);
      return 0;
    }

    if (action === 'back' || action === 'forward' || action === 'reload') {
      const id = tabId();
      const method =
        action === 'back' ? 'browser.back' : action === 'forward' ? 'browser.forward' : 'browser.reload';
      const result = await withClient(parsed, (client) =>
        client.call(method, { tabId: id } satisfies AgentRpcParams['browser.back']),
      );
      printJson(result);
      return 0;
    }

    if (action === 'snapshot') {
      const { flags } = parseFlags(parsed.rest, { tab: 'string', 'max-nodes': 'number', 'max-bytes': 'number' });
      const id = requireFlag(flags, 'tab');
      const params: AgentRpcParams['browser.snapshot'] = { tabId: id };
      if (typeof flags['max-nodes'] === 'number') params.maxNodes = flags['max-nodes'];
      if (typeof flags['max-bytes'] === 'number') params.maxBytes = flags['max-bytes'];
      const result = await withClient(parsed, (client) => client.call('browser.snapshot', params));
      printJson(result);
      return 0;
    }

    if (action === 'query') {
      const { flags } = parseFlags(parsed.rest, {
        tab: 'string',
        role: 'string',
        name: 'string',
        text: 'string',
        selector: 'string',
      });
      const id = requireFlag(flags, 'tab');
      const params: AgentRpcParams['browser.query'] = { tabId: id };
      if (typeof flags.role === 'string') params.role = flags.role;
      if (typeof flags.name === 'string') params.name = flags.name;
      if (typeof flags.text === 'string') params.text = flags.text;
      if (typeof flags.selector === 'string') params.selector = flags.selector;
      const result = await withClient(parsed, (client) => client.call('browser.query', params));
      printJson(result);
      return 0;
    }

    if (action === 'wait-for') {
      const { flags } = parseFlags(parsed.rest, {
        tab: 'string',
        selector: 'string',
        text: 'string',
        'load-state': 'string',
        'timeout-ms': 'number',
        'poll-interval-ms': 'number',
      });
      const id = requireFlag(flags, 'tab');
      const params: AgentRpcParams['browser.waitFor'] = { tabId: id };
      if (typeof flags.selector === 'string') params.selector = flags.selector;
      if (typeof flags.text === 'string') params.text = flags.text;
      if (flags['load-state'] === 'load' || flags['load-state'] === 'idle') {
        params.loadState = flags['load-state'];
      } else if (typeof flags['load-state'] === 'string') {
        throw new Error('--load-state must be load or idle');
      }
      if (typeof flags['timeout-ms'] === 'number') params.timeoutMs = flags['timeout-ms'];
      if (typeof flags['poll-interval-ms'] === 'number') params.pollIntervalMs = flags['poll-interval-ms'];
      const result = await withClient(parsed, (client) => client.call('browser.waitFor', params));
      printJson(result);
      return 0;
    }

    if (action === 'click') {
      const { flags } = parseFlags(parsed.rest, { tab: 'string', ref: 'string' });
      const result = await withClient(parsed, (client) =>
        client.call('browser.click', {
          tabId: requireFlag(flags, 'tab'),
          ref: requireFlag(flags, 'ref'),
        } satisfies AgentRpcParams['browser.click']),
      );
      printJson(result);
      return 0;
    }

    if (action === 'type') {
      const { flags, passthrough } = parseFlags(parsed.rest, {
        tab: 'string',
        ref: 'string',
        text: 'string',
        'no-clear': 'boolean',
      });
      const id = requireFlag(flags, 'tab');
      const ref = requireFlag(flags, 'ref');
      const text =
        typeof flags.text === 'string'
          ? flags.text
          : passthrough.length > 0
            ? passthrough.join(' ')
            : null;
      if (!text) throw new Error('text is required (--text or after --)');
      const params: AgentRpcParams['browser.type'] = { tabId: id, ref, text };
      if (flags['no-clear'] === true) params.clear = false;
      const result = await withClient(parsed, (client) => client.call('browser.type', params));
      printJson(result);
      return 0;
    }

    if (action === 'press') {
      const { flags } = parseFlags(parsed.rest, { tab: 'string', ref: 'string', key: 'string' });
      const result = await withClient(parsed, (client) =>
        client.call('browser.press', {
          tabId: requireFlag(flags, 'tab'),
          ref: requireFlag(flags, 'ref'),
          key: requireFlag(flags, 'key'),
        } satisfies AgentRpcParams['browser.press']),
      );
      printJson(result);
      return 0;
    }

    if (action === 'get-url' || action === 'get-title') {
      const id = tabId();
      const method = action === 'get-url' ? 'browser.getUrl' : 'browser.getTitle';
      const result = await withClient(parsed, (client) =>
        client.call(method, { tabId: id } satisfies AgentRpcParams['browser.getUrl']),
      );
      printJson(result);
      return 0;
    }
  }

  if (group === 'events') {
    parseFlags(parsed.rest, { json: 'boolean' });
    await withClient(parsed, async (client) => {
      await client.call('events.subscribe', {});
      const unsubscribe = client.onNotification((notification) => {
        if (notification.method !== AGENT_EVENT_NOTIFICATION) return;
        printJson(notification.params);
      });
      await new Promise<void>((resolve) => {
        const onSignal = () => {
          unsubscribe();
          resolve();
        };
        process.once('SIGINT', onSignal);
        process.once('SIGTERM', onSignal);
      });
    });
    return 0;
  }

  throw new Error(`Unknown command: ${parsed.command.join(' ')}`);
}

export async function runCli(argv: string[]): Promise<number> {
  try {
    const parsed = parseArgv(argv);
    return await runCommand(parsed);
  } catch (error) {
    handleError(error);
  }
}
