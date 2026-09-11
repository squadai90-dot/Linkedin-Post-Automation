#!/usr/bin/env node
// Builds a self-contained, zero-dependency zip of the 5471 Work Paper that
// anyone can unzip and run on a local server with nothing but Node installed.
// Usage: node scripts/make-bundle.mjs [outputPath]
import { mkdir, rm, cp, writeFile, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(process.argv[2] || join(repo, 'dist-bundle', '5471-work-paper-local.zip'));
const stage = join(repo, 'dist-bundle', 'stage', '5471-work-paper');

const { version } = JSON.parse(await readFile(join(repo, 'package.json'), 'utf8'));

await rm(join(repo, 'dist-bundle'), { recursive: true, force: true });
await mkdir(stage, { recursive: true });
await cp(join(repo, 'dist'), join(stage, 'dist'), { recursive: true });
await cp(join(repo, 'scripts', 'serve-local.mjs'), join(stage, 'serve.mjs'));

await writeFile(join(stage, 'start.sh'), `#!/bin/sh\nexec node "$(dirname "$0")/serve.mjs" "\${1:-8080}"\n`, { mode: 0o755 });
await writeFile(join(stage, 'start.cmd'), '@echo off\r\nnode "%~dp0serve.mjs" %1\r\n');

await writeFile(join(stage, 'README.txt'), `5471 Work Paper ${version} - run it on your own machine

REQUIREMENT
  Node.js 18 or newer. Nothing else: no npm install, no internet.

RUN
  macOS / Linux:   ./start.sh          (or: node serve.mjs)
  Windows:         start.cmd           (or: node serve.mjs)

  Then open http://localhost:8080 in your browser.
  A different port:  node serve.mjs 3000

WITHOUT A SERVER
  dist/index.html is fully self-contained - you can also just double-click it
  and open it straight in a browser. Serving it is only needed if your browser
  restricts local file:// pages.

WHAT IT IS
  The whole app is one HTML file. Your documents are parsed in the browser and
  never leave your machine; there is no backend to configure.

STOP
  Ctrl+C in the terminal running the server.
`);

await mkdir(dirname(out), { recursive: true });
execFileSync('zip', ['-qr', out, '5471-work-paper'], { cwd: join(repo, 'dist-bundle', 'stage') });
await rm(join(repo, 'dist-bundle', 'stage'), { recursive: true, force: true });
console.log(`Bundle written: ${out}`);
