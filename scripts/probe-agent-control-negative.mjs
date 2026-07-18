#!/usr/bin/env node
/**
 * Negative / limit probes for the agent control NDJSON transport (ADR 0013).
 *
 * Exercises unauthorized RPC, bad tokens, parse errors, oversized frames,
 * and the max-client accept gate without faking device results.
 *
 * Usage:
 *   npm run probe:agent-control-negative
 *
 * Requires GOSH_PORT (+ GOSH_TOKEN for max-client test). See probe-agent-control-transport.mjs.
 */

import {
  loadAgentControlConfig,
  requirePort,
  requireToken,
} from './lib/agent-control-config.mjs';
import {
  AgentControlProbeClient,
  connectRaw,
  readOneResponse,
} from './lib/agent-control-client.mjs';
import {
  AGENT_PAYLOAD_TOO_LARGE,
  AGENT_UNAUTHORIZED,
  AUTH_METHOD,
  DEFAULT_MAX_FRAME_BYTES,
  RPC_PARSE_ERROR,
  encodeFrame,
} from './lib/agent-control-protocol.mjs';

const checks = [];
const pass = (name, detail = '') => {
  checks.push(true);
  console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`);
};
const fail = (name, detail) => {
  checks.push(false);
  console.error(`  ✗ ${name}: ${detail}`);
};

async function expectRpcError(promise, expectedCode, label) {
  try {
    await promise;
    fail(label, `expected JSON-RPC error ${expectedCode}`);
  } catch (error) {
    if (error.code === expectedCode) pass(label, `code ${expectedCode}`);
    else fail(label, `expected ${expectedCode}, got ${error.code ?? error.message}`);
  }
}

async function main() {
  console.log('Agent control negative transport probes (ADR 0013)\n');

  const config = loadAgentControlConfig();
  let port;
  try {
    port = requirePort(config);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }

  const { host, token } = config;
  console.log(`Target: ${host}:${port}\n`);

  // 1. Workspace RPC before authenticate
  {
    const client = new AgentControlProbeClient({ host, port, token: token ?? '' });
    try {
      await client.open({ authenticate: false });
      await expectRpcError(
        client.request('workspace.listTabs', {}),
        AGENT_UNAUTHORIZED,
        'workspace.listTabs before auth → unauthorized',
      );
    } catch (error) {
      fail('workspace.listTabs before auth → unauthorized', error.message);
    } finally {
      client.close();
    }
  }

  // 2. Wrong pairing token
  if (token) {
    const client = new AgentControlProbeClient({ host, port, token });
    try {
      await client.open({ authenticate: false });
      await expectRpcError(
        client.authenticate('definitely-wrong-token'),
        AGENT_UNAUTHORIZED,
        'gosh.authenticate wrong token → unauthorized',
      );
    } catch (error) {
      fail('gosh.authenticate wrong token → unauthorized', error.message);
    } finally {
      client.close();
    }
  } else {
    console.log('  ⊘ gosh.authenticate wrong token — skipped (no GOSH_TOKEN)');
  }

  // 3. Invalid JSON frame
  {
    const socket = await connectRaw({ host, port });
    try {
      socket.write('{not json}\n');
      const response = await readOneResponse(socket);
      if (response?.error?.code === RPC_PARSE_ERROR) {
        pass('invalid JSON frame → parse-error', `code ${RPC_PARSE_ERROR}`);
      } else {
        fail('invalid JSON frame → parse-error', JSON.stringify(response));
      }
    } catch (error) {
      fail('invalid JSON frame → parse-error', error.message);
    } finally {
      socket.end();
    }
  }

  // 4. Oversized frame (after auth)
  if (token) {
    const client = new AgentControlProbeClient({ host, port, token });
    try {
      await client.open();
      const oversized = `${'a'.repeat(DEFAULT_MAX_FRAME_BYTES + 64)}\n`;
      client.writeRaw(oversized);
      const response = await readOneResponse(client.socket, 8000);
      if (response?.error?.code === AGENT_PAYLOAD_TOO_LARGE) {
        pass('oversized frame → payload-too-large', `code ${AGENT_PAYLOAD_TOO_LARGE}`);
      } else {
        fail('oversized frame → payload-too-large', JSON.stringify(response));
      }
    } catch (error) {
      fail('oversized frame → payload-too-large', error.message);
    } finally {
      client.close();
    }
  } else {
    console.log('  ⊘ oversized frame — skipped (no GOSH_TOKEN)');
  }

  // 5. Fifth simultaneous client rejected at accept
  if (token) {
    try {
      requireToken(config);
    } catch {
      console.log('  ⊘ max clients — skipped (no GOSH_TOKEN)');
      reportAndExit();
      return;
    }

    const holders = [];
    try {
      for (let i = 0; i < 4; i += 1) {
        const client = new AgentControlProbeClient({ host, port, token });
        await client.open();
        holders.push(client);
      }
      pass('four authenticated clients held open');

      const fifth = await connectRaw({ host, port });
      let rejected = false;
      const onClose = () => {
        rejected = true;
      };
      fifth.once('close', onClose);
      try {
        fifth.write(
          encodeFrame({
            jsonrpc: '2.0',
            method: AUTH_METHOD,
            params: { token },
            id: 99,
          }),
        );
        await readOneResponse(fifth, 2000);
      } catch {
        // Expected when accept gate closes the socket.
      }
      await new Promise((r) => setTimeout(r, 250));
      if (rejected || fifth.destroyed) {
        pass('5th client rejected at accept', 'connection closed without slot');
      } else {
        fail('5th client rejected at accept', 'connection remained open');
        fifth.end();
      }
    } catch (error) {
      fail('max client accept gate', error.message);
    } finally {
      for (const client of holders) client.close();
    }
  }

  reportAndExit();
}

function reportAndExit() {
  const failed = checks.filter((ok) => !ok).length;
  console.log(`\n${checks.length - failed}/${checks.length} passed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
