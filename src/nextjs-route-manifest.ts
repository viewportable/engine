import { normalizeProjectRoute } from './project-route.js';

const SKIP_PAGES_ROUTES = new Set(['/_app', '/_document', '/_error', '/404', '/500']);
const SKIP_APP_INTERNAL_KEYS = new Set(['/_global-error/page', '/_not-found/page']);
const SKIP_APP_ROUTES = new Set(['/_global-error', '/_not-found']);

export interface NextJsDiscoveredRoute {
  route: string;
  manifest: 'pages-manifest' | 'app-path-routes-manifest';
  internalKey: string;
}

function parseStringRecord(content: string, source: string): Record<string, string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(`Invalid JSON in Next.js route manifest: ${source}`);
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Next.js route manifest must be an object: ${source}`);
  }

  const record: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value !== 'string') {
      throw new Error(`Next.js route manifest values must be strings: ${source}#${key}`);
    }
    record[key] = value;
  }
  return record;
}

function isDynamicRoute(route: string): boolean {
  return route.includes('[') || route.includes(']');
}

function isPagesApiRoute(route: string): boolean {
  return route === '/api' || route.startsWith('/api/');
}

function isRenderableStaticRoute(route: string): boolean {
  return !isDynamicRoute(route);
}

export function parseNextJsPagesManifest(
  content: string,
  source = 'server/pages-manifest.json',
): NextJsDiscoveredRoute[] {
  const manifest = parseStringRecord(content, source);
  const routes: NextJsDiscoveredRoute[] = [];

  for (const route of Object.keys(manifest)) {
    if (SKIP_PAGES_ROUTES.has(route) || isPagesApiRoute(route) || !isRenderableStaticRoute(route)) {
      continue;
    }

    routes.push({
      route: normalizeProjectRoute(route),
      manifest: 'pages-manifest',
      internalKey: route,
    });
  }

  return routes;
}

export function parseNextJsAppManifests({
  appPathsContent,
  appPathRoutesContent,
  appPathsSource = 'server/app-paths-manifest.json',
  appPathRoutesSource = 'app-path-routes-manifest.json',
}: {
  appPathsContent: string;
  appPathRoutesContent: string;
  appPathsSource?: string;
  appPathRoutesSource?: string;
}): NextJsDiscoveredRoute[] {
  const appPaths = parseStringRecord(appPathsContent, appPathsSource);
  const routeMap = parseStringRecord(appPathRoutesContent, appPathRoutesSource);
  const routes: NextJsDiscoveredRoute[] = [];

  for (const internalKey of Object.keys(appPaths)) {
    if (SKIP_APP_INTERNAL_KEYS.has(internalKey) || internalKey.endsWith('/route')) {
      continue;
    }

    if (!internalKey.endsWith('/page')) {
      continue;
    }

    const route = routeMap[internalKey];
    if (route === undefined) {
      throw new Error(
        `Next.js app path is missing from ${appPathRoutesSource}: ${internalKey}`,
      );
    }

    if (
      SKIP_APP_ROUTES.has(route) ||
      isPagesApiRoute(route) ||
      !isRenderableStaticRoute(route)
    ) {
      continue;
    }

    routes.push({
      route: normalizeProjectRoute(route),
      manifest: 'app-path-routes-manifest',
      internalKey,
    });
  }

  return routes;
}
