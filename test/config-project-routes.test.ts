import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadSliceConfig } from '../src/config.js';

describe('project routes config', () => {
  it('accepts a deterministic explicit origin-relative route set', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'viewportable-routes-config-'));
    const configPath = path.join(root, 'slice.config.json');

    try {
      await writeFile(
        configPath,
        JSON.stringify({
          routes: ['/', '/dashboard', '/settings?tab=profile'],
        }),
      );

      const loaded = await loadSliceConfig(configPath);
      expect(loaded.config.routes).toEqual(['/', '/dashboard', '/settings?tab=profile']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects duplicate and cross-origin-like routes', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'viewportable-routes-config-'));

    try {
      const duplicatePath = path.join(root, 'duplicate.json');
      await writeFile(duplicatePath, JSON.stringify({ routes: ['/dashboard', '/dashboard'] }));
      await expect(loadSliceConfig(duplicatePath)).rejects.toThrow('routes must not contain duplicates');

      const crossOriginPath = path.join(root, 'cross-origin.json');
      await writeFile(crossOriginPath, JSON.stringify({ routes: ['//example.com/escape'] }));
      await expect(loadSliceConfig(crossOriginPath)).rejects.toThrow(
        'route must be an origin-relative path beginning with one /',
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
