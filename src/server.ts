import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { selectEngine } from './engine-port';
import { Store } from './store';
import { createToolServer } from './tools';

/** `<app root>/data`, where the bundle lives at `<app root>/dist/server.mjs`. */
function defaultDataDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.join(path.dirname(here), 'data');
}

async function main(): Promise<void> {
  const dir = process.env.NECROMANCER_DATA_DIR || defaultDataDir();
  const server = createToolServer({ engine: selectEngine(), store: new Store(dir) });
  await server.connect(new StdioServerTransport());
  // stdout carries JSON-RPC. Anything for humans goes to stderr.
  console.error(`necromancer MCP server ready (data: ${dir})`);
}

main().catch((err) => {
  console.error('necromancer MCP server failed:', err);
  process.exit(1);
});
