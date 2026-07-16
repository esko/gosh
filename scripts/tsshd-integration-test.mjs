import { execSync, spawn } from 'node:child_process';
import { join } from 'node:path';

const RELAY = join(import.meta.dirname, '../vendor/tsshd-relay/tsshd-relay');
const BOOTSTRAP_CMD = 'ssh -T -o StrictHostKeyChecking=accept-new -o ConnectTimeout=5 localhost "/opt/homebrew/bin/tsshd 2>/dev/null" 2>/dev/null';

const raw = execSync(BOOTSTRAP_CMD, { encoding: 'utf8', timeout: 15000 });
const clean = raw.replace(/\r/g, '').replace(/\n/g, '');
const s = clean.indexOf('{'), e = clean.lastIndexOf('}');

if (s < 0 || e <= s) {
  console.error('No JSON in bootstrap output:', clean.substring(0, 100));
  process.exit(1);
}

const json = JSON.parse(clean.substring(s, e + 1));
const clientId = clean.match(/"ClientID":(\d+)/)?.[1];
const serverId = clean.match(/"ServerID":(\d+)/)?.[1];

const args = `${json.Port}:${json.ProxyKey}:${clientId}:${serverId}:${json.Mode}`;
process.stdout.write(args);
