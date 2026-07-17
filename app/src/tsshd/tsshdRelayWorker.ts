import { createDirectUdpBridge, type DirectUdpBridge, type DirectUdpSocketConstructor } from './directUdpBridge';

const TSSHD_WASM_URL = new URL('./runtime/tsshd-client.wasm', import.meta.url);

type GoRuntime = {
  importObject: WebAssembly.Imports;
  run(instance: WebAssembly.Instance): Promise<void>;
};

type GoConstructor = new () => GoRuntime;

type TsshdWorkerGlobal = typeof globalThis & {
  UDPSocket?: DirectUdpSocketConstructor;
  Go?: GoConstructor;
  tsshdConnect?: (config: string) => void;
  tsshdSendInput?: (data: string) => void;
  tsshdResize?: (cols: number, rows: number) => void;
  tsshdDisconnect?: () => void;
  __tsshdUdp?: DirectUdpBridge;
};

type WorkerCommand =
  | { type: 'connect'; host: string; serverInfo: unknown; cols: number; rows: number }
  | { type: 'input'; data: string }
  | { type: 'resize'; cols: number; rows: number }
  | { type: 'disconnect' };

const scope = globalThis as TsshdWorkerGlobal;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function reportError(error: unknown): void {
  scope.postMessage({ type: 'error', message: errorMessage(error) });
}

scope.__tsshdUdp = createDirectUdpBridge(scope.UDPSocket);

let ready = false;
const queued: WorkerCommand[] = [];

function dispatch(command: WorkerCommand): void {
  switch (command.type) {
    case 'connect':
      scope.tsshdConnect?.(JSON.stringify({
        host: command.host,
        serverInfo: command.serverInfo,
        cols: command.cols,
        rows: command.rows,
      }));
      break;
    case 'input':
      scope.tsshdSendInput?.(command.data);
      break;
    case 'resize':
      scope.tsshdResize?.(command.cols, command.rows);
      break;
    case 'disconnect':
      scope.tsshdDisconnect?.();
      break;
  }
}

scope.addEventListener('message', (event: MessageEvent<WorkerCommand>) => {
  const command = event.data;
  if (!command || typeof command !== 'object' || !['connect', 'input', 'resize', 'disconnect'].includes(command.type)) {
    reportError('Invalid TSSHD worker command.');
    return;
  }
  if (!ready) queued.push(command);
  else dispatch(command);
});

scope.addEventListener('messageerror', () => reportError('Unable to decode a TSSHD worker message.'));

async function boot(): Promise<void> {
  await import('./runtime/wasm_exec.js');
  if (typeof scope.Go !== 'function') throw new Error('TSSHD Go runtime failed to load.');

  const response = await fetch(TSSHD_WASM_URL, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`TSSHD WASM failed to load (${response.status}).`);
  const contentType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'application/wasm') {
    throw new Error(`TSSHD WASM has invalid content type: ${contentType || 'missing'}.`);
  }

  const go = new scope.Go();
  const { instance } = await WebAssembly.instantiateStreaming(response, go.importObject);
  void go.run(instance).catch(reportError);

  const deadline = Date.now() + 5_000;
  while (typeof scope.tsshdConnect !== 'function') {
    if (Date.now() >= deadline) throw new Error('TSSHD WASM did not initialize.');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  ready = true;
  scope.postMessage({ type: 'ready' });
  for (const command of queued.splice(0)) dispatch(command);
}

void boot().catch(reportError);
