#!/usr/bin/env node
import { GoshControlClient } from './client.js';
import { runGoshMcpServer } from './server.js';

async function main(): Promise<void> {
  const client = await GoshControlClient.fromEnv();
  const shutdown = () => {
    client.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  await runGoshMcpServer(client);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`gosh-mcp: ${message}`);
  process.exit(1);
});
