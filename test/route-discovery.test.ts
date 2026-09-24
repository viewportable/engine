import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MAX_DISCOVERED_ROUTES,
  discoverProjectRoutes,
  parseRouteFile,
  parseSitemapRoutes,
} from '../src/route-discovery.js';

describe('static route discovery', () => {
  it('merges explicit, file, and same-origin sitemap routes with stable provenance', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'viewportable-route-discovery-'));

    try {
      await writeFile(
        path.join(root, 'routes.txt'),
        ['# app routes', '/dashboard', '/settings?tab=profile', '/dashboard', ''].join('\n'),
      );

      const result = await discoverProjectRoutes({
        baseUrl: 'https://example.com',
        explicitRoutes: ['/', '/dashboard'],
        discovery: {
          files: ['routes.txt'],
          sitemaps: ['/sitemap.xml'],
        },
        rootDir: root,
        fetchSitemap: async () =>
          [
            '<?xml version="1.0"?>',
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
            '  <url><loc>https://example.com/pricing?plan=pro&amp;period=year</loc></url>',
            '  <url><loc>https://example.com/dashboard</loc></url>',
            '</urlset>',
          ].join('\n'),
      });

      expect(result).toMatchObject({
        mode: 'mixed',
        routeCount: 4,
        routes: ['/', '/dashboard', '/settings?tab=profile', '/pricing?plan=pro&period=year'],
        sources: [
          { kind: 'config', discoveredRoutes: 2 },
          { kind: 'file', source: 'routes.txt', discoveredRoutes: 3 },
          { kind: 'sitemap', source: '/sitemap.xml', discoveredRoutes: 2 },
        ],
      });

      const dashboard = result.entries.find((entry) => entry.route === '/dashboard');
      expect(dashboard?.sources).toEqual([
        { kind: 'config' },
        { kind: 'file', path: 'routes.txt', line: 2 },
        { kind: 'file', path: 'routes.txt', line: 4 },
        {
          kind: 'sitemap',
          path: '/sitemap.xml',
          location: 'https://example.com/dashboard',
        },
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects cross-origin sitemap locations and sitemap indexes', () => {
    expect(() =>
      parseSitemapRoutes('<urlset><url><loc>https://evil.example/path</loc></url></urlset>', {
        baseUrl: 'https://example.com',
        sitemapPath: '/sitemap.xml',
      }),
    ).toThrow('must stay on the base URL origin');

    expect(() =>
      parseSitemapRoutes(
        '<sitemapindex><sitemap><loc>https://example.com/a.xml</loc></sitemap></sitemapindex>',
        {
          baseUrl: 'https://example.com',
          sitemapPath: '/sitemap.xml',
        },
      ),
    ).toThrow('Sitemap indexes are not supported');
  });

  it('rejects invalid route-file entries with exact source line evidence', () => {
    expect(() => parseRouteFile('/ok\nhttps://evil.example/path\n', 'routes.txt')).toThrow(
      'Invalid route in routes.txt:2',
    );
  });

  it('enforces the global unique-route discovery bound', async () => {
    const routes = Array.from({ length: MAX_DISCOVERED_ROUTES + 1 }, (_, index) => `/r-${index}`);

    await expect(
      discoverProjectRoutes({
        baseUrl: 'https://example.com',
        explicitRoutes: routes,
      }),
    ).rejects.toThrow(`exceeds the ${MAX_DISCOVERED_ROUTES} route limit`);
  });

  it('fails when discovery yields no routes', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'viewportable-route-discovery-empty-'));

    try {
      await writeFile(path.join(root, 'routes.txt'), '# comments only\n');

      await expect(
        discoverProjectRoutes({
          baseUrl: 'https://example.com',
          discovery: { files: ['routes.txt'] },
          rootDir: root,
        }),
      ).rejects.toThrow('produced zero routes');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it('merges static Next.js Pages and App Router manifests with provenance', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'viewportable-nextjs-route-discovery-'));

    try {
      await mkdir(path.join(root, '.next/server'), { recursive: true });
      await writeFile(
        path.join(root, '.next/server/pages-manifest.json'),
        JSON.stringify({
          '/legacy': 'pages/legacy.js',
          '/blog/[slug]': 'pages/blog/[slug].js',
          '/api/health': 'pages/api/health.js',
        }),
      );
      await writeFile(
        path.join(root, '.next/server/app-paths-manifest.json'),
        JSON.stringify({
          '/pricing/(marketing)/page': 'app/pricing/(marketing)/page.js',
          '/account/[id]/page': 'app/account/[id]/page.js',
          '/api/app/route': 'app/api/app/route.js',
        }),
      );
      await writeFile(
        path.join(root, '.next/app-path-routes-manifest.json'),
        JSON.stringify({
          '/pricing/(marketing)/page': '/pricing',
          '/account/[id]/page': '/account/[id]',
          '/api/app/route': '/api/app',
        }),
      );

      const result = await discoverProjectRoutes({
        baseUrl: 'https://example.com',
        explicitRoutes: ['/'],
        discovery: {
          nextjs: [{ distDir: '.next' }],
        },
        rootDir: root,
      });

      expect(result).toMatchObject({
        mode: 'mixed',
        routeCount: 3,
        routes: ['/', '/legacy', '/pricing'],
        sources: [
          {
            kind: 'config',
            source: 'slice.config.json#routes',
            discoveredRoutes: 1,
          },
          {
            kind: 'nextjs',
            source: '.next',
            discoveredRoutes: 2,
          },
        ],
      });
      expect(result.entries[1]).toEqual({
        route: '/legacy',
        sources: [
          {
            kind: 'nextjs-manifest',
            distDir: '.next',
            manifest: 'pages-manifest',
            internalKey: '/legacy',
          },
        ],
      });
      expect(result.entries[2]).toEqual({
        route: '/pricing',
        sources: [
          {
            kind: 'nextjs-manifest',
            distDir: '.next',
            manifest: 'app-path-routes-manifest',
            internalKey: '/pricing/(marketing)/page',
          },
        ],
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('requires canonical App Router mapping when app-paths-manifest exists', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'viewportable-nextjs-route-discovery-missing-'));

    try {
      await mkdir(path.join(root, '.next/server'), { recursive: true });
      await writeFile(
        path.join(root, '.next/server/app-paths-manifest.json'),
        JSON.stringify({
          '/page': 'app/page.js',
        }),
      );

      await expect(
        discoverProjectRoutes({
          baseUrl: 'https://example.com',
          discovery: {
            nextjs: [{ distDir: '.next' }],
          },
          rootDir: root,
        }),
      ).rejects.toThrow(
        'Next.js App Router discovery requires .next/app-path-routes-manifest.json',
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

});
