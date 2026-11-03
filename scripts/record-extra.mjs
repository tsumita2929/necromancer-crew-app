// Records live answers for URLs the engine's own recordings lack, into test/recorded.
//   node scripts/record-extra.mjs <url> [<url> ...]
// Same file naming as the engine's recorder, so test/recorded-fetch.ts finds them.
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

const dir = path.resolve(import.meta.dirname, '../test/recorded');
for (const url of process.argv.slice(2)) {
  const slug = `GET_${url.replace(/^https?:\/\//, '')}`.replace(/[^A-Za-z0-9]+/g, '_').slice(0, 120);
  const hash = createHash('sha1').update(`GET ${url}`).digest('hex').slice(0, 8);
  const res = await fetch(url, { headers: { 'user-agent': 'necromancer-recorder', accept: 'application/json' } });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  const file = `${slug}_${hash}.json`;
  writeFileSync(path.join(dir, file), JSON.stringify({ request: { method: 'GET', url }, status: res.status, body }));
  console.log(res.status, file);
}
