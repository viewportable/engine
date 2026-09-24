import { describe, expect, it } from 'vitest';
import {
  parseNextJsAppManifests,
  parseNextJsPagesManifest,
} from '../src/nextjs-route-manifest.js';

describe('Next.js route manifest adapter', () => {
  it('keeps only renderable static Pages Router paths', () => {
    const routes = parseNextJsPagesManifest(
      JSON.stringify({
        '/': 'pages/index.js',
        '/about': 'pages/about.js',
        '/blog/[slug]': 'pages/blog/[slug].js',
        '/api/health': 'pages/api/health.js',
        '/_app': 'pages/_app.js',
        '/_document': 'pages/_document.js',
        '/_error': 'pages/_error.js',
        '/404': 'pages/404.html',
        '/500': 'pages/500.html',
      }),
    );

    expect(routes).toEqual([
      {
        route: '/',
        manifest: 'pages-manifest',
        internalKey: '/',
      },
      {
        route: '/about',
        manifest: 'pages-manifest',
        internalKey: '/about',
      },
    ]);
  });

  it('uses app-path-routes-manifest as the canonical App Router URL mapping', () => {
    const routes = parseNextJsAppManifests({
      appPathsContent: JSON.stringify({
        '/page': 'app/page.js',
        '/pricing/(marketing)/page': 'app/pricing/(marketing)/page.js',
        '/blog/[slug]/page': 'app/blog/[slug]/page.js',
        '/api/health/route': 'app/api/health/route.js',
        '/_not-found/page': 'app/_not-found/page.js',
        '/_global-error/page': 'app/_global-error/page.js',
      }),
      appPathRoutesContent: JSON.stringify({
        '/page': '/',
        '/pricing/(marketing)/page': '/pricing',
        '/blog/[slug]/page': '/blog/[slug]',
        '/api/health/route': '/api/health',
        '/_not-found/page': '/_not-found',
        '/_global-error/page': '/_global-error',
      }),
    });

    expect(routes).toEqual([
      {
        route: '/',
        manifest: 'app-path-routes-manifest',
        internalKey: '/page',
      },
      {
        route: '/pricing',
        manifest: 'app-path-routes-manifest',
        internalKey: '/pricing/(marketing)/page',
      },
    ]);
  });

  it('fails closed when a built App Router page has no canonical route mapping', () => {
    expect(() =>
      parseNextJsAppManifests({
        appPathsContent: JSON.stringify({
          '/pricing/page': 'app/pricing/page.js',
        }),
        appPathRoutesContent: JSON.stringify({}),
      }),
    ).toThrow(
      'Next.js app path is missing from app-path-routes-manifest.json: /pricing/page',
    );
  });

  it('rejects malformed manifest shapes instead of guessing', () => {
    expect(() => parseNextJsPagesManifest('[]')).toThrow(
      'Next.js route manifest must be an object',
    );

    expect(() =>
      parseNextJsPagesManifest(JSON.stringify({ '/about': 42 })),
    ).toThrow('Next.js route manifest values must be strings');
  });
});
