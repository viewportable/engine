export function isOriginRelativeProjectRoute(route: string): boolean {
  return /^\/(?!\/)/.test(route);
}

export function normalizeProjectRoute(route: string): string {
  const normalized = route.trim();

  if (!isOriginRelativeProjectRoute(normalized)) {
    throw new Error(`Project route must be an origin-relative path beginning with one /: ${route}`);
  }

  const parsed = new URL(normalized, 'http://viewportable.invalid');
  return `${parsed.pathname}${parsed.search}`;
}
