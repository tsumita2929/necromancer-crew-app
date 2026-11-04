// Stdio smoke test: start the server the way the platform does (through
// mcp/launch.py), list its tools and answer one call. Prints one result line per step.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const data = mkdtempSync(path.join(tmpdir(), 'necromancer-smoke-'));

const transport = new StdioClientTransport({
  command: process.platform === 'win32' ? 'python' : 'python3',
  args: [path.join(root, 'mcp', 'launch.py')],
  // Plumbing check, offline by default. `SMOKE_ENGINE=real npm run smoke` uses the live engine.
  env: { ...process.env, NECROMANCER_DATA_DIR: data, NECROMANCER_ENGINE: process.env.SMOKE_ENGINE === 'real' ? 'real' : 'stub' },
  stderr: 'pipe',
});
const client = new Client({ name: 'smoke', version: '0.0.0' });
await client.connect(transport);

const { tools } = await client.listTools();
console.log(`SMOKE tools/list: ${tools.length} tools: ${tools.map((t) => t.name).join(', ')}`);

const call = await client.callTool({
  name: 'successors',
  arguments: { ecosystem: 'npm', name: 'left-pad' },
});
const body = JSON.parse(call.content[0].text);
console.log(
  `SMOKE tools/call successors(left-pad): isError=${Boolean(call.isError)} engine=${body.engine} verdict=${body.verdict} first=${body.successors[0]?.name}`,
);

await client.close();
if (tools.length < 10 || call.isError || body.verdict !== 'dead') {
  console.error('SMOKE FAILED');
  process.exit(1);
}
console.log('SMOKE OK');
