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
      await expect(loadSliceConfig(duplicatePath)).rejects.toThrow(
        'routes must not contain duplicates',
      );

      const crossOriginPath = path.join(root, 'cross-origin.json');
      await writeFile(crossOriginPath, JSON.stringify({ routes: ['//example.com/escape'] }));
      await expect(loadSliceConfig(crossOriginPath)).rejects.toThrow(
        'route must be an origin-relative path beginning with one /',
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('validates conservative route impact mappings against configured routes', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'viewportable-route-impact-config-'));

    try {
      const validPath = path.join(root, 'valid.json');
      await writeFile(
        validPath,
        JSON.stringify({
          routes: ['/', '/dashboard'],
          routeImpact: [
            {
              paths: ['src/dashboard/', 'src/components/Nav.tsx'],
              routes: ['/dashboard'],
            },
            {
              paths: ['src/styles/'],
              routes: 'all',
            },
          ],
        }),
      );

      const valid = await loadSliceConfig(validPath);
      expect(valid.config.routeImpact).toEqual([
        {
          paths: ['src/dashboard/', 'src/components/Nav.tsx'],
          routes: ['/dashboard'],
        },
        {
          paths: ['src/styles/'],
          routes: 'all',
        },
      ]);

      const missingRoutesPath = path.join(root, 'missing-routes.json');
      await writeFile(
        missingRoutesPath,
        JSON.stringify({
          routeImpact: [{ paths: ['src/'], routes: 'all' }],
        }),
      );
      await expect(loadSliceConfig(missingRoutesPath)).rejects.toThrow(
        'routeImpact requires routes or routeDiscovery',
      );

      const unknownRoutePath = path.join(root, 'unknown-route.json');
      await writeFile(
        unknownRoutePath,
        JSON.stringify({
          routes: ['/'],
          routeImpact: [{ paths: ['src/dashboard/'], routes: ['/dashboard'] }],
        }),
      );
      await expect(loadSliceConfig(unknownRoutePath)).rejects.toThrow(
        'routeImpact references unconfigured route: /dashboard',
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it('accepts bounded file and sitemap discovery and defers discovered route impact validation', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'viewportable-route-discovery-config-'));

    try {
      const configPath = path.join(root, 'discovery.json');
      await writeFile(
        configPath,
        JSON.stringify({
          routeDiscovery: {
            files: ['config/routes.txt'],
            sitemaps: ['/sitemap.xml'],
          },
          routeImpact: [
            {
              paths: ['src/dashboard/'],
              routes: ['/dashboard'],
            },
          ],
        }),
      );

      const loaded = await loadSliceConfig(configPath);
      expect(loaded.config.routeDiscovery).toEqual({
        files: ['config/routes.txt'],
        sitemaps: ['/sitemap.xml'],
      });
      expect(loaded.config.routeImpact?.[0]?.routes).toEqual(['/dashboard']);

      const invalidFilePath = path.join(root, 'invalid-file.json');
      await writeFile(
        invalidFilePath,
        JSON.stringify({
          routeDiscovery: {
            files: ['../outside.txt'],
          },
        }),
      );
      await expect(loadSliceConfig(invalidFilePath)).rejects.toThrow(
        'route discovery file must be a normalized repo-relative file path',
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
