import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const bins = {
  slice: packageJson.bin?.slice,
  'viewportable-mcp': packageJson.bin?.['viewportable-mcp'],
};

for (const [name, bin] of Object.entries(bins)) {
  if (typeof bin !== 'string') {
    throw new Error(`package.json must expose the ${name} binary`);
  }

  const source = await readFile(path.resolve(root, bin), 'utf8');

  if (!source.startsWith('#!/usr/bin/env node\n')) {
    throw new Error(`Package bin ${bin} is missing the Node.js shebang`);
  }

  process.stdout.write(`Package bin OK · ${name} -> ${bin}\n`);
}
