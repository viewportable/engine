import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { writeCanonicalAgentEvidenceV5 } from '../src/contracts/write-agent-evidence-v5.js';
import { resolveProjectRoute, runProjectScan } from '../src/project-scan.js';

async function writeRouteResult(
  outDir: string,
  {
    exitCode,
    finding,
  }: {
    exitCode: 0 | 1;
    finding?: boolean;
  },
): Promise<void> {
  await mkdir(outDir, { recursive: true });
  const reportPath = path.join(outDir, 'results.json');
  const report = {
    summary: {
      viewportsChecked: 1,
      failed: finding ? 1 : 0,
      durationMs: 5,
    },
    rootCauses: finding
      ? [
          {
            id: 'root-1',
            type: 'horizontal-overflow',
            selector: '.wide',
            diagnosis: null,
          },
        ]
      : [],
    viewports: [
      {
        width: 390,
        status: finding ? 'fail' : 'pass',
        issues: [],
      },
    ],
  };

  await writeFile(reportPath, JSON.stringify(report));
  await writeCanonicalAgentEvidenceV5(outDir, {
    mode: 'scan',
    exitCode,
    outcome: exitCode === 0 ? 'clean' : 'findings',
    reportPath,
    report,
    stderr: '',
  });
}

describe('multi-page project scan', () => {
  it('aggregates explicit routes while preserving each strict V5 result', async () => {
    const outDir = await mkdtemp(path.join(tmpdir(), 'viewportable-project-scan-'));

    try {
      const execution = await runProjectScan({
        baseUrl: 'http://127.0.0.1:4173/app',
        routes: ['/', '/dashboard'],
        outDir,
        runRoute: async (url, routeOut) => {
          const finding = url.endsWith('/dashboard');
          await writeRouteResult(routeOut, { exitCode: finding ? 1 : 0, finding });
          return finding ? 1 : 0;
        },
      });

      expect(execution.exitCode).toBe(1);
      expect(execution.report.summary).toMatchObject({
        routesChecked: 2,
        cleanRoutes: 1,
        findingRoutes: 1,
        infraFailureRoutes: 0,
        viewportsChecked: 2,
      });
      expect(execution.agentEvidence).toMatchObject({
        schemaVersion: 'viewportable.project-agent-evidence.v1',
        mode: 'project-scan',
        outcome: 'findings',
        exitCode: 1,
        routes: [
          {
            route: '/',
            evidence: {
              schemaVersion: 'viewportable.agent-evidence.v5',
              outcome: 'clean',
            },
          },
          {
            route: '/dashboard',
            evidence: {
              schemaVersion: 'viewportable.agent-evidence.v5',
              outcome: 'findings',
            },
          },
        ],
      });

      const persisted = JSON.parse(await readFile(execution.agentEvidencePath, 'utf8'));
      expect(persisted.schemaVersion).toBe('viewportable.project-agent-evidence.v1');
      expect(execution.report.routes[0]?.reportPath).toContain('routes/001-root/results.json');
      expect(execution.report.routes[1]?.reportPath).toContain('routes/002-dashboard/results.json');
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });

  it('continues after an infrastructure failure and gives exit 2 precedence', async () => {
    const outDir = await mkdtemp(path.join(tmpdir(), 'viewportable-project-scan-infra-'));

    try {
      const execution = await runProjectScan({
        baseUrl: 'http://127.0.0.1:4173',
        routes: ['/missing', '/fixed'],
        outDir,
        runRoute: async (url, routeOut) => {
          if (url.endsWith('/missing')) throw new Error('page did not become ready');
          await writeRouteResult(routeOut, { exitCode: 0 });
          return 0;
        },
      });

      expect(execution.exitCode).toBe(2);
      expect(execution.report.summary).toMatchObject({
        routesChecked: 2,
        cleanRoutes: 1,
        findingRoutes: 0,
        infraFailureRoutes: 1,
      });
      expect(execution.report.routes[0]).toMatchObject({
        route: '/missing',
        status: 'infra_failure',
        exitCode: 2,
        reportPath: null,
        error: 'page did not become ready',
      });
      expect(execution.report.routes[1]?.status).toBe('pass');
      expect(execution.agentEvidence.error).toContain('1 route(s) failed');
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });

  it('resolves routes on the base origin and rejects cross-origin resolution', () => {
    expect(resolveProjectRoute('https://example.com/app', '/dashboard')).toBe(
      'https://example.com/dashboard',
    );
    expect(() => resolveProjectRoute('https://example.com/app', '//evil.example/path')).toThrow(
      'must stay on the base URL origin',
    );
  });
});
