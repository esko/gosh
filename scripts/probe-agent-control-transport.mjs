#!/usr/bin/env node
/**
 * Loopback agent control transport probe (ADR 0013 / C2).
 *
 * Connects to the installed IWA listener, authenticates, and exercises
 * gosh.capabilities + workspace.listTabs + workspace.listPanes.
 *
 * Usage (from Crostini or the Chromebook shell):
 *   npm run probe:agent-control-transport
 *
 * Credentials (any alias works):
 *   GOSH_HOST / GOSH_AGENT_HOST          default 127.0.0.1
 *   GOSH_PORT / GOSH_AGENT_PORT          or ~/.config/gosh/port
 *   GOSH_TOKEN / GOSH_AGENT_TOKEN        or ~/.config/gosh/token
 *
 * Copy port + token from Gosh Settings → Security while a terminal window is open.
 */

import {
  loadAgentControlConfig,
  requirePort,
  requireToken,
} from './lib/agent-control-config.mjs';
import { AgentControlProbeClient } from './lib/agent-control-client.mjs';
import { AGENT_PROTOCOL_VERSION } from './lib/agent-control-protocol.mjs';

const checks = [];
const pass = (name, detail = '') => {
  checks.push(true);
  console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`);
};
const fail = (name, detail) => {
  checks.push(false);
  console.error(`  ✗ ${name}: ${detail}`);
};

async function main() {
  console.log('Agent control transport probe (ADR 0013)\n');

  let config;
  try {
    config = loadAgentControlConfig();
    requirePort(config);
    requireToken(config);
  } catch (error) {
    console.error(error.message);
    console.error('\nEnable Settings → Security → External agent control, then export:');
    console.error('  export GOSH_PORT=<port> GOSH_TOKEN=<token>');
    console.error('Or write ~/.config/gosh/{port,token} (chmod 600).');
    process.exit(1);
  }

  const { host, port, token } = config;
  console.log(`Target: ${host}:${port}\n`);

  const client = new AgentControlProbeClient({ host, port, token });

  try {
    await client.open();
    pass('TCP connect + gosh.authenticate');
  } catch (error) {
    fail('TCP connect + gosh.authenticate', error.message);
    client.close();
    reportAndExit();
    return;
  }

  try {
    const caps = await client.request('gosh.capabilities', { protocolVersion: AGENT_PROTOCOL_VERSION });
    if (caps?.protocolVersion === AGENT_PROTOCOL_VERSION && caps?.methods) {
      pass('gosh.capabilities', `protocol v${caps.protocolVersion}`);
    } else {
      fail('gosh.capabilities', JSON.stringify(caps));
    }
  } catch (error) {
    fail('gosh.capabilities', error.message);
  }

  try {
    const tabs = await client.request('workspace.listTabs', {});
    if (Array.isArray(tabs) && tabs.length >= 1 && typeof tabs[0]?.tabId === 'string') {
      pass('workspace.listTabs', `${tabs.length} tab(s)`);
    } else {
      fail('workspace.listTabs', JSON.stringify(tabs));
    }
  } catch (error) {
    fail('workspace.listTabs', error.message);
  }

  try {
    const panes = await client.request('workspace.listPanes', {});
    if (Array.isArray(panes) && panes.length >= 1 && typeof panes[0]?.paneId === 'string') {
      pass('workspace.listPanes', `${panes.length} pane(s)`);
    } else {
      fail('workspace.listPanes', JSON.stringify(panes));
    }
  } catch (error) {
    fail('workspace.listPanes', error.message);
  }

  client.close();
  reportAndExit();
}

function reportAndExit() {
  const failed = checks.filter((ok) => !ok).length;
  console.log(`\n${checks.length - failed}/${checks.length} passed`);
  if (failed > 0) {
    console.log('\nRecord failures in docs/agent/CHROMEBOOK_VALIDATION.md');
    process.exit(1);
  }
  console.log('\nTransport probe OK — continue the C2 checklist in docs/agent/CHROMEBOOK_VALIDATION.md');
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
