// Calls one tool of the Necromancer MCP server over stdio and prints the answer.
//   node scripts/mcp-call.mjs <tool> '<json arguments>'
//   node scripts/mcp-call.mjs --list      (each tool, its description and the shape of its arguments)
// It starts the server the way the platform does (mcp/launch.py), so it is a stand-in for an
// agent host that cannot attach the server itself. Exit code 1 when the tool answers an error.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.dirname(import.meta.dirname);
const [tool, rawArgs] = process.argv.slice(2);
if (!tool) {
  console.error("usage: node scripts/mcp-call.mjs <tool> '<json arguments>' | --list");
  process.exit(2);
}

const transport = new StdioClientTransport({
  command: process.platform === 'win32' ? 'python' : 'python3',
  args: [path.join(root, 'mcp', 'launch.py')],
  env: {
    ...process.env,
    NECROMANCER_DATA_DIR: process.env.NECROMANCER_DATA_DIR || mkdtempSync(path.join(tmpdir(), 'necromancer-call-')),
  },
  stderr: 'ignore',
});
const client = new Client({ name: 'mcp-call', version: '0.0.0' });
await client.connect(transport);
let code = 0;

/** A JSON-schema type in a few words: "npm"|"pypi", string, array of {name: string, spec?: string}. */
function shape(schema, depth = 0) {
  if (!schema || typeof schema !== 'object') return 'any';
  if (Array.isArray(schema.enum)) return schema.enum.map((v) => JSON.stringify(v)).join('|');
  if (schema.type === 'array') return `array of ${shape(schema.items, depth + 1)}`;
  if (schema.type === 'object' && schema.properties && depth < 3) {
    const required = new Set(schema.required ?? []);
    const fields = Object.entries(schema.properties).map(([k, v]) => `${k}${required.has(k) ? '' : '?'}: ${shape(v, depth + 1)}`);
    return `{${fields.join(', ')}}`;
  }
  return Array.isArray(schema.type) ? schema.type.join('|') : (schema.type ?? 'any');
}

if (tool === '--list') {
  const { tools } = await client.listTools();
  for (const t of tools) {
    console.log(`${t.name}: ${t.description}`);
    const props = t.inputSchema?.properties ?? {};
    const required = new Set(t.inputSchema?.required ?? []);
    const args = Object.entries(props).map(([k, v]) => `${k}${required.has(k) ? '' : '?'}: ${shape(v)}`);
    console.log(`  arguments: ${args.length > 0 ? args.join('; ') : '(none)'}   (a ? after a name means the argument is optional)`);
    const mode = t.annotations?.readOnlyHint ? 'read-only' : 'may write or change state';
    console.log(`  kind: ${mode}`);
  }
} else {
  const result = await client.callTool({ name: tool, arguments: rawArgs ? JSON.parse(rawArgs) : {} });
  console.log(result.content[0].text);
  if (result.isError) code = 1;
}
await client.close();
process.exit(code);
