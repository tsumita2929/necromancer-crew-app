// After a build: the files app.json points at exist, resolved the way the platform resolves them.
//   node scripts/check-bundles.mjs
// The platform serves a page bundle from <app>/ui/<ui.entry> (routes_static: ui_root = apps_dir() / name / "ui"),
// so `ui.entry: "dist/index.mjs"` means ui/dist/index.mjs, where the UI build writes it. The MCP server bundle is
// dist/server.mjs, started by mcp/launch.py. Prints one line per file and exits 1 when one is missing or empty.
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const root = path.dirname(import.meta.dirname);
const manifest = JSON.parse(readFileSync(path.join(root, 'app.json'), 'utf8'));
const checks = [
  ['ui.entry', path.join('ui', manifest.ui?.entry ?? 'dist/index.mjs')],
  ['MCP server', path.join('dist', 'server.mjs')],
];
let bad = 0;
for (const [label, rel] of checks) {
  const file = path.join(root, rel);
  const size = existsSync(file) ? statSync(file).size : 0;
  const ok = size > 1000;
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${label === 'ui.entry' ? ` "${manifest.ui?.entry}"` : ''} -> ${rel.split(path.sep).join('/')} (${size} bytes)`);
}
process.exit(bad === 0 ? 0 : 1);
