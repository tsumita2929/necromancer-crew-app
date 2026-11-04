import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '..');
const manifest = JSON.parse(readFileSync(path.join(root, 'app.json'), 'utf8'));

describe('app.json and the build agree (QA-04)', () => {
  it('ui.entry is where the UI build writes the page bundle, resolved from ui/ as the platform does', () => {
    const config = readFileSync(path.join(root, 'ui/vite.config.ts'), 'utf8');
    const outDir = /outDir:\s*'([^']+)'/.exec(config)?.[1];
    const fileName = /fileName:\s*\(\)\s*=>\s*'([^']+)'/.exec(config)?.[1];
    expect(outDir, 'outDir in ui/vite.config.ts').toBeTruthy();
    expect(fileName, 'fileName in ui/vite.config.ts').toBeTruthy();
    // The platform serves <app>/ui/<ui.entry>; the build writes ui/<outDir>/<fileName>.
    expect(manifest.ui.entry).toBe(`${outDir}/${fileName}`);
    expect(path.isAbsolute(manifest.ui.entry)).toBe(false);
    expect(manifest.ui.entry.split('/')).not.toContain('..');
  });

  it('the bundle script checks both built files after a build', () => {
    const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
    expect(pkg.scripts.bundle).toContain('scripts/check-bundles.mjs');
  });

  it('the MCP server starts through a Python launcher that app.json names, and the bundle it runs is dist/server.mjs', () => {
    const server = manifest.mcpServers.necromancer;
    expect(server.args).toEqual(['mcp/launch.py']);
    expect(readFileSync(path.join(root, 'mcp/launch.py'), 'utf8')).toContain('"dist", "server.mjs"');
  });

  it('QA-19: tools that write files or watch new projects are not auto-approved', () => {
    const approved: string[] = manifest.mcpServers.necromancer.autoApprove;
    expect(approved).toContain('seance'); // the preview is read-only
    expect(approved).not.toContain('seance_write');
    expect(approved).not.toContain('watch_add');
    expect(approved).not.toContain('watch_remove');
  });

  it('asks only for the permissions it uses', () => {
    expect(manifest.permissions).toEqual({ api: ['/apps/necromancer/api'], cron: true });
  });
});
