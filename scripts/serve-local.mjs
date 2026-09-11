#!/usr/bin/env node
// Zero-dependency static server for the 5471 Work Paper.
// Serves the committed dist/ with no network access and no install step.
// Usage: node scripts/serve-local.mjs [port]     (default 8080)
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

// Works both from scripts/ in the repo and from the root of the unzipped bundle.
const here = dirname(fileURLToPath(import.meta.url));
const root = [join(here, '..', 'dist'), join(here, 'dist')].find((d) =>
  existsSync(join(d, 'index.html')),
);
if (!root) {
  console.error('Could not find dist/index.html next to this script.');
  process.exit(1);
}
const port = Number(process.argv[2] || process.env.PORT || 8080);

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
  // Single-page app: everything falls back to index.html.
  const file = path === '/' || !path.includes('.') ? 'index.html' : path.replace(/^\/+/, '');
  const ext = file.slice(file.lastIndexOf('.'));
  try {
    const body = await readFile(join(root, file));
    res.writeHead(200, {
      'content-type': types[ext] || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(body);
  } catch {
    // Unknown path: fall back to the single-page app rather than 404-ing.
    try {
      const body = await readFile(join(root, 'index.html'));
      res.writeHead(200, { 'content-type': types['.html'], 'cache-control': 'no-store' });
      res.end(body);
    } catch (err) {
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(String(err && err.message ? err.message : err));
    }
  }
}).listen(port, () => {
  console.log(`5471 Work Paper running at http://localhost:${port}`);
  console.log('Press Ctrl+C to stop.');
});
