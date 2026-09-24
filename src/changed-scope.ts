import type { RouteImpactRule } from './config.js';

export type ProjectScopeReason =
  | {
      kind: 'full-project-scan';
    }
  | {
      kind: 'path-match';
      changedFile: string;
      impactPath: string;
    }
  | {
      kind: 'unknown-impact';
      changedFile: string;
    };

export interface ProjectRouteSelection {
  route: string;
  reasons: ProjectScopeReason[];
}

export interface ProjectScopePlan {
  mode: 'full' | 'changed';
  changedFiles: string[];
  configuredRoutes: number;
  selectedRoutes: number;
  broadened: boolean;
  unknownFiles: string[];
  selections: ProjectRouteSelection[];
}

function normalizeChangedFile(value: string): string {
  const normalized = value.trim();

  if (
    normalized.length === 0 ||
    normalized.startsWith('/') ||
    normalized.startsWith('./') ||
    normalized.includes('\\') ||
    normalized.includes('//') ||
    normalized.split('/').includes('..')
  ) {
    throw new Error(
      `Changed file must be a normalized repo-relative path without ./, .., //, or backslashes: ${value}`,
    );
  }

  return normalized;
}

function pathMatches(changedFile: string, impactPath: string): boolean {
  return impactPath.endsWith('/')
    ? changedFile.startsWith(impactPath)
    : changedFile === impactPath;
}

function appendReason(
  reasonsByRoute: Map<string, ProjectScopeReason[]>,
  route: string,
  reason: ProjectScopeReason,
): void {
  const reasons = reasonsByRoute.get(route);
  if (reasons) {
    const serialized = JSON.stringify(reason);
    if (!reasons.some((existing) => JSON.stringify(existing) === serialized)) {
      reasons.push(reason);
    }
    return;
  }

  reasonsByRoute.set(route, [reason]);
}

export function planProjectScope({
  routes,
  routeImpact = [],
  changedFiles = [],
}: {
  routes: string[];
  routeImpact?: RouteImpactRule[];
  changedFiles?: string[];
}): ProjectScopePlan {
  const normalizedChangedFiles = [
    ...new Set(changedFiles.map((changedFile) => normalizeChangedFile(changedFile))),
  ];

  if (normalizedChangedFiles.length === 0) {
    return {
      mode: 'full',
      changedFiles: [],
      configuredRoutes: routes.length,
      selectedRoutes: routes.length,
      broadened: false,
      unknownFiles: [],
      selections: routes.map((route) => ({
        route,
        reasons: [{ kind: 'full-project-scan' }],
      })),
    };
  }

  const configuredRouteSet = new Set(routes);
  const reasonsByRoute = new Map<string, ProjectScopeReason[]>();
  const unknownFiles: string[] = [];

  for (const changedFile of normalizedChangedFiles) {
    const matchingRules = routeImpact.filter((rule) =>
      rule.paths.some((impactPath) => pathMatches(changedFile, impactPath)),
    );

    if (matchingRules.length === 0) {
      unknownFiles.push(changedFile);
      continue;
    }

    for (const rule of matchingRules) {
      for (const impactPath of rule.paths) {
        if (!pathMatches(changedFile, impactPath)) continue;

        const impactedRoutes = rule.routes === 'all' ? routes : rule.routes;
        for (const route of impactedRoutes) {
          if (!configuredRouteSet.has(route)) continue;
          appendReason(reasonsByRoute, route, {
            kind: 'path-match',
            changedFile,
            impactPath,
          });
        }
      }
    }
  }

  const broadened = unknownFiles.length > 0;
  if (broadened) {
    for (const route of routes) {
      for (const changedFile of unknownFiles) {
        appendReason(reasonsByRoute, route, {
          kind: 'unknown-impact',
          changedFile,
        });
      }
    }
  }

  const selections = routes
    .filter((route) => reasonsByRoute.has(route))
    .map((route) => ({
      route,
      reasons: reasonsByRoute.get(route) ?? [],
    }));

  return {
    mode: 'changed',
    changedFiles: normalizedChangedFiles,
    configuredRoutes: routes.length,
    selectedRoutes: selections.length,
    broadened,
    unknownFiles,
    selections,
  };
}
