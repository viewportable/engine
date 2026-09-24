import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { RouteDiscoveryConfig } from './config.js';
import { normalizeProjectRoute } from './project-route.js';

export const MAX_ROUTE_DISCOVERY_SOURCE_BYTES = 1_000_000;
export const MAX_DISCOVERED_ROUTES = 1_000;

export type RouteDiscoverySource =
  | {
      kind: 'config';
    }
  | {
      kind: 'file';
      path: string;
      line: number;
    }
  | {
      kind: 'sitemap';
      path: string;
      location: string;
    };

export interface RouteDiscoveryEntry {
  route: string;
  sources: RouteDiscoverySource[];
}

export interface RouteDiscoveryResult {
  mode: 'explicit' | 'discovered' | 'mixed';
  routeCount: number;
  routes: string[];
  entries: RouteDiscoveryEntry[];
  sources: Array<{
    kind: 'config' | 'file' | 'sitemap';
    source: string;
    discoveredRoutes: number;
  }>;
}

export type SitemapFetcher = (url: string, timeoutMs: number) => Promise<string>;

function assertSourceSize(content: string, source: string): void {
  const bytes = Buffer.byteLength(content, 'utf8');
  if (bytes > MAX_ROUTE_DISCOVERY_SOURCE_BYTES) {
    throw new Error(
      `Route discovery source exceeds ${MAX_ROUTE_DISCOVERY_SOURCE_BYTES} bytes: ${source}`,
    );
  }
}

function decodeXml(value: string): string {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'");
}

function appendRoute(
  byRoute: Map<string, RouteDiscoverySource[]>,
  route: string,
  source: RouteDiscoverySource,
): void {
  const normalized = normalizeProjectRoute(route);
  const existing = byRoute.get(normalized);

  if (existing) {
    existing.push(source);
    return;
  }

  if (byRoute.size >= MAX_DISCOVERED_ROUTES) {
    throw new Error(`Route discovery exceeds the ${MAX_DISCOVERED_ROUTES} route limit`);
  }

  byRoute.set(normalized, [source]);
}

function repoRelativeFilePath(value: string): string {
  if (
    value.length === 0 ||
    value.startsWith('/') ||
    value.startsWith('./') ||
    value.endsWith('/') ||
    value.includes('\\') ||
    value.includes('//') ||
    value.split('/').includes('..')
  ) {
    throw new Error(
      `Route file must be a normalized repo-relative file path without ./, .., //, trailing /, or backslashes: ${value}`,
    );
  }

  return value;
}

async function readRouteFile(rootDir: string, filePath: string): Promise<string> {
  const normalized = repoRelativeFilePath(filePath);
  const absoluteRoot = path.resolve(rootDir);
  const absolutePath = path.resolve(absoluteRoot, normalized);

  if (absolutePath !== absoluteRoot && !absolutePath.startsWith(`${absoluteRoot}${path.sep}`)) {
    throw new Error(`Route file escapes project root: ${filePath}`);
  }

  let content: string;
  try {
    content = await readFile(absolutePath, 'utf8');
  } catch {
    throw new Error(`Could not read route discovery file: ${filePath}`);
  }

  assertSourceSize(content, filePath);
  return content;
}

export function parseRouteFile(content: string, filePath: string): Array<{
  route: string;
  line: number;
}> {
  assertSourceSize(content, filePath);
  const routes: Array<{ route: string; line: number }> = [];

  for (const [index, rawLine] of content.split(/\r?\n/).entries()) {
    const value = rawLine.trim();
    if (!value || value.startsWith('#')) continue;

    try {
      routes.push({
        route: normalizeProjectRoute(value),
        line: index + 1,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid route in ${filePath}:${index + 1}: ${message}`);
    }
  }

  return routes;
}

export function parseSitemapRoutes(
  content: string,
  {
    baseUrl,
    sitemapPath,
  }: {
    baseUrl: string;
    sitemapPath: string;
  },
): Array<{ route: string; location: string }> {
  assertSourceSize(content, sitemapPath);

  if (/<\s*sitemapindex\b/i.test(content)) {
    throw new Error(
      `Sitemap indexes are not supported by bounded Route Discovery V2: ${sitemapPath}`,
    );
  }

  if (!/<\s*urlset\b/i.test(content)) {
    throw new Error(`Route discovery sitemap is not a sitemap urlset: ${sitemapPath}`);
  }

  const base = new URL(baseUrl);
  const routes: Array<{ route: string; location: string }> = [];
  const locPattern = /<\s*loc\b[^>]*>([\s\S]*?)<\/\s*loc\s*>/gi;

  for (const match of content.matchAll(locPattern)) {
    const rawLocation = decodeXml((match[1] ?? '').trim());
    if (!rawLocation) continue;

    let location: URL;
    try {
      location = new URL(rawLocation, base);
    } catch {
      throw new Error(`Invalid sitemap location in ${sitemapPath}: ${rawLocation}`);
    }

    if (location.origin !== base.origin) {
      throw new Error(
        `Route discovery sitemap location must stay on the base URL origin: ${rawLocation}`,
      );
    }

    location.hash = '';
    routes.push({
      route: normalizeProjectRoute(`${location.pathname}${location.search}`),
      location: location.href,
    });
  }

  return routes;
}

async function defaultFetchSitemap(url: string, timeoutMs: number): Promise<string> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      accept: 'application/xml,text/xml;q=0.9,*/*;q=0.1',
    },
  });

  if (!response.ok) {
    throw new Error(`Could not fetch route discovery sitemap ${url}: HTTP ${response.status}`);
  }

  const declaredLength = Number(response.headers.get('content-length'));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_ROUTE_DISCOVERY_SOURCE_BYTES
  ) {
    throw new Error(
      `Route discovery source exceeds ${MAX_ROUTE_DISCOVERY_SOURCE_BYTES} bytes: ${url}`,
    );
  }

  const content = await response.text();
  assertSourceSize(content, url);
  return content;
}

export async function discoverProjectRoutes({
  baseUrl,
  explicitRoutes = [],
  discovery,
  rootDir = process.cwd(),
  timeoutMs = 30_000,
  fetchSitemap = defaultFetchSitemap,
}: {
  baseUrl: string;
  explicitRoutes?: string[];
  discovery?: RouteDiscoveryConfig;
  rootDir?: string;
  timeoutMs?: number;
  fetchSitemap?: SitemapFetcher;
}): Promise<RouteDiscoveryResult> {
  const byRoute = new Map<string, RouteDiscoverySource[]>();
  const sources: RouteDiscoveryResult['sources'] = [];

  for (const route of explicitRoutes) {
    appendRoute(byRoute, route, { kind: 'config' });
  }
  if (explicitRoutes.length > 0) {
    sources.push({
      kind: 'config',
      source: 'slice.config.json#routes',
      discoveredRoutes: explicitRoutes.length,
    });
  }

  for (const filePath of discovery?.files ?? []) {
    const content = await readRouteFile(rootDir, filePath);
    const fileRoutes = parseRouteFile(content, filePath);

    for (const item of fileRoutes) {
      appendRoute(byRoute, item.route, {
        kind: 'file',
        path: filePath,
        line: item.line,
      });
    }

    sources.push({
      kind: 'file',
      source: filePath,
      discoveredRoutes: fileRoutes.length,
    });
  }

  const base = new URL(baseUrl);
  for (const sitemapPath of discovery?.sitemaps ?? []) {
    const sitemapUrl = new URL(sitemapPath, base);
    if (sitemapUrl.origin !== base.origin) {
      throw new Error(`Route discovery sitemap must stay on the base URL origin: ${sitemapPath}`);
    }

    const content = await fetchSitemap(sitemapUrl.href, timeoutMs);
    const sitemapRoutes = parseSitemapRoutes(content, {
      baseUrl,
      sitemapPath,
    });

    for (const item of sitemapRoutes) {
      appendRoute(byRoute, item.route, {
        kind: 'sitemap',
        path: sitemapPath,
        location: item.location,
      });
    }

    sources.push({
      kind: 'sitemap',
      source: sitemapPath,
      discoveredRoutes: sitemapRoutes.length,
    });
  }

  if (byRoute.size === 0) {
    throw new Error('Project route discovery produced zero routes');
  }

  const entries = [...byRoute.entries()].map(([route, routeSources]) => ({
    route,
    sources: routeSources,
  }));
  const hasExplicit = explicitRoutes.length > 0;
  const hasDiscovery = Boolean((discovery?.files?.length ?? 0) + (discovery?.sitemaps?.length ?? 0));

  return {
    mode: hasExplicit && hasDiscovery ? 'mixed' : hasExplicit ? 'explicit' : 'discovered',
    routeCount: entries.length,
    routes: entries.map((entry) => entry.route),
    entries,
    sources,
  };
}
