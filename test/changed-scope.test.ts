import { describe, expect, it } from 'vitest';
import { planProjectScope } from '../src/changed-scope.js';

describe('changed-scope planner', () => {
  const routes = ['/', '/dashboard', '/settings'];

  it('selects only routes mapped by exact files and directory prefixes', () => {
    const scope = planProjectScope({
      routes,
      routeImpact: [
        {
          paths: ['src/dashboard/', 'src/components/Nav.tsx'],
          routes: ['/dashboard'],
        },
        {
          paths: ['src/settings/'],
          routes: ['/settings'],
        },
      ],
      changedFiles: ['src/dashboard/Card.tsx'],
    });

    expect(scope).toEqual({
      mode: 'changed',
      changedFiles: ['src/dashboard/Card.tsx'],
      configuredRoutes: 3,
      selectedRoutes: 1,
      broadened: false,
      unknownFiles: [],
      selections: [
        {
          route: '/dashboard',
          reasons: [
            {
              kind: 'path-match',
              changedFile: 'src/dashboard/Card.tsx',
              impactPath: 'src/dashboard/',
            },
          ],
        },
      ],
    });
  });

  it('supports explicitly mapped all-route changes without treating them as unknown', () => {
    const scope = planProjectScope({
      routes,
      routeImpact: [
        {
          paths: ['src/styles/'],
          routes: 'all',
        },
      ],
      changedFiles: ['src/styles/tokens.css'],
    });

    expect(scope.broadened).toBe(false);
    expect(scope.unknownFiles).toEqual([]);
    expect(scope.selections.map((selection) => selection.route)).toEqual(routes);
    for (const selection of scope.selections) {
      expect(selection.reasons).toEqual([
        {
          kind: 'path-match',
          changedFile: 'src/styles/tokens.css',
          impactPath: 'src/styles/',
        },
      ]);
    }
  });

  it('broadens to all configured routes when any changed file has unknown impact', () => {
    const scope = planProjectScope({
      routes,
      routeImpact: [
        {
          paths: ['src/dashboard/'],
          routes: ['/dashboard'],
        },
      ],
      changedFiles: ['src/dashboard/Card.tsx', 'package.json'],
    });

    expect(scope.mode).toBe('changed');
    expect(scope.broadened).toBe(true);
    expect(scope.unknownFiles).toEqual(['package.json']);
    expect(scope.selections.map((selection) => selection.route)).toEqual(routes);

    expect(scope.selections.find((selection) => selection.route === '/dashboard')?.reasons).toEqual(
      [
        {
          kind: 'path-match',
          changedFile: 'src/dashboard/Card.tsx',
          impactPath: 'src/dashboard/',
        },
        {
          kind: 'unknown-impact',
          changedFile: 'package.json',
        },
      ],
    );
    expect(scope.selections.find((selection) => selection.route === '/')?.reasons).toEqual([
      {
        kind: 'unknown-impact',
        changedFile: 'package.json',
      },
    ]);
  });

  it('uses the whole configured route set when no changed files are supplied', () => {
    const scope = planProjectScope({
      routes,
      routeImpact: [
        {
          paths: ['src/dashboard/'],
          routes: ['/dashboard'],
        },
      ],
    });

    expect(scope).toMatchObject({
      mode: 'full',
      configuredRoutes: 3,
      selectedRoutes: 3,
      broadened: false,
      unknownFiles: [],
    });
    expect(scope.selections).toEqual(
      routes.map((route) => ({
        route,
        reasons: [{ kind: 'full-project-scan' }],
      })),
    );
  });

  it('rejects changed file paths that are not normalized repo-relative paths', () => {
    expect(() =>
      planProjectScope({
        routes,
        changedFiles: ['../outside.ts'],
      }),
    ).toThrow('Changed file must be a normalized repo-relative path');

    expect(() =>
      planProjectScope({
        routes,
        changedFiles: ['/absolute.ts'],
      }),
    ).toThrow('Changed file must be a normalized repo-relative path');
  });
  it('rejects route impact references that were not produced by discovery', () => {
    expect(() =>
      planProjectScope({
        routes: ['/', '/dashboard'],
        routeImpact: [
          {
            paths: ['src/settings/'],
            routes: ['/settings'],
          },
        ],
        changedFiles: ['src/settings/Form.tsx'],
      }),
    ).toThrow('routeImpact references undiscovered route: /settings');
  });
});
