// Bundles the MCP server into one file, dist/server.mjs, so the installed app
// needs no node_modules. The real engine is never bundled (it is loaded by name).
import { build } from 'esbuild';

await build({
  entryPoints: ['src/server.ts'],
  outfile: 'dist/server.mjs',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  external: ['@necromancer/engine'],
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
  logLevel: 'info',
});
