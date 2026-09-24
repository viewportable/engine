import { describe, expect, it } from 'vitest';
import { createViewportableMcpServer } from '../src/mcp-server.js';
import {
  buildEngineArgs,
  canonicalMcpResult,
  mcpTextSummary,
  type EngineMcpRun,
} from '../src/mcp-runner.js';

describe('Viewportable MCP runner', () => {
  it('registers scan and compare tools with explicit schemas', () => {
    const server = createViewportableMcpServer();

    expect(server.toolInputSchemaJson('viewportable_scan')).toMatchObject({
      type: 'object',
      properties: {
        url: { type: 'string' },
      },
      required: ['url'],
    });
    expect(server.toolInputSchemaJson('viewportable_compare')).toMatchObject({
      type: 'object',
      properties: {
        baselineUrl: { type: 'string' },
        candidateUrl: { type: 'string' },
      },
      required: expect.arrayContaining(['baselineUrl', 'candidateUrl']),
    });
  });

  it('builds scan CLI arguments from the MCP contract', () => {
    const args = buildEngineArgs({
      candidateUrl: 'http://127.0.0.1:3000',
      outDir: '/tmp/evidence',
      options: {
        widths: [320, 390, 768],
        height: 844,
        waitMs: 0,
        timeoutMs: 10_000,
        boundary: false,
        readySelector: '#app',
        config: 'slice.config.json',
        changedFiles: ['src/home/Hero.tsx', 'src/shared/theme.ts'],
      },
    });

    expect(args.slice(1)).toEqual([
      'http://127.0.0.1:3000',
      '--out',
      '/tmp/evidence',
      '--widths',
      '320,390,768',
      '--height',
      '844',
      '--wait',
      '0',
      '--timeout',
      '10000',
      '--no-boundary',
      '--ready-selector',
      '#app',
      '--config',
      'slice.config.json',
      '--changed-file',
      'src/home/Hero.tsx',
      '--changed-file',
      'src/shared/theme.ts',
    ]);
  });

  it('builds compare CLI arguments without inventing a second Engine path', () => {
    const args = buildEngineArgs({
      baselineUrl: 'http://127.0.0.1:3000',
      candidateUrl: 'http://127.0.0.1:3001',
      outDir: '/tmp/evidence',
      options: {},
    });

    expect(args.slice(1)).toEqual([
      'http://127.0.0.1:3001',
      '--out',
      '/tmp/evidence',
      '--baseline-url',
      'http://127.0.0.1:3000',
    ]);
  });

  it('returns only introduced canonical findings from compare reports', () => {
    const run: EngineMcpRun = {
      mode: 'compare',
      exitCode: 1,
      outcome: 'findings',
      reportPath: '.slice/mcp/compare-123/structural-diff.json',
      stderr: '',
      report: {
        summary: {
          viewportsChecked: 4,
          introducedRanges: 1,
          resolvedRanges: 1,
        },
        findings: [
          {
            id: 'introduced',
            direction: 'introduced',
            type: 'disappearance',
            exactRange: { minWidth: 350, maxWidth: 499 },
          },
          {
            id: 'resolved',
            direction: 'resolved',
            type: 'appearance',
          },
        ],
      },
    };

    const result = canonicalMcpResult(run);

    expect(result).toMatchObject({
      schemaVersion: 'viewportable.agent-evidence.v5',
      mode: 'compare',
      outcome: 'findings',
      exitCode: 1,
      summary: {
        viewportsChecked: 4,
        findingCount: 1,
        introducedCount: 1,
        resolvedCount: 1,
        durationMs: null,
      },
      findings: [
        {
          id: 'introduced',
          direction: 'introduced',
          type: 'disappearance',
          source: null,
          repair: {
            repairable: false,
            reason: 'unsupported-finding',
          },
        },
      ],
      evidence: {
        reportPath: '.slice/mcp/compare-123/structural-diff.json',
        format: 'structural-diff.v1',
      },
      error: null,
    });
    expect(mcpTextSummary(result)).toContain('1 introduced finding(s)');
  });

  it('returns failing viewports and canonical root causes for scans', () => {
    const run: EngineMcpRun = {
      mode: 'scan',
      exitCode: 1,
      outcome: 'findings',
      reportPath: '.slice/mcp/scan-123/results.json',
      stderr: '',
      report: {
        summary: {
          viewportsChecked: 3,
          failed: 1,
        },
        rootCauses: [{ id: 'root-1', type: 'horizontal-overflow' }],
        viewports: [
          { width: 320, status: 'pass', issues: [] },
          { width: 390, status: 'fail', issues: [{ id: 'issue-1' }] },
          { width: 768, status: 'pass', issues: [] },
        ],
      },
    };

    const result = canonicalMcpResult(run);

    expect(result).toMatchObject({
      schemaVersion: 'viewportable.agent-evidence.v5',
      mode: 'scan',
      outcome: 'findings',
      summary: {
        viewportsChecked: 3,
        findingCount: 0,
        introducedCount: 0,
        resolvedCount: 0,
        durationMs: null,
      },
      findings: [],
      evidence: {
        reportPath: '.slice/mcp/scan-123/results.json',
        format: 'results.v1',
      },
      error: null,
    });
    expect(mcpTextSummary(result)).toContain('0 current finding(s)');
  });

  it('returns the project evidence envelope without flattening per-route V5 semantics', () => {
    const routeEvidence = {
      schemaVersion: 'viewportable.agent-evidence.v5',
      mode: 'scan',
      outcome: 'clean',
      exitCode: 0,
      summary: {
        viewportsChecked: 1,
        findingCount: 0,
        introducedCount: 0,
        resolvedCount: 0,
        durationMs: 5,
      },
      findings: [],
      evidence: {
        reportPath: '.slice/mcp/scan-123/routes/001-root/results.json',
        format: 'results.v1',
      },
      error: null,
    } as const;

    const result = canonicalMcpResult({
      mode: 'scan',
      exitCode: 0,
      outcome: 'clean',
      reportPath: '.slice/mcp/scan-123/project-results.json',
      report: {
        mode: 'project-scan',
      },
      stderr: '',
      agentEvidence: {
        schemaVersion: 'viewportable.project-agent-evidence.v1',
        mode: 'project-scan',
        outcome: 'clean',
        exitCode: 0,
        summary: {
          routesChecked: 1,
          cleanRoutes: 1,
          findingRoutes: 0,
          infraFailureRoutes: 0,
          viewportsChecked: 1,
          findingCount: 0,
          durationMs: 7,
        },
        routes: [
          {
            route: '/',
            url: 'http://127.0.0.1:3000/',
            evidence: routeEvidence,
          },
        ],
        evidence: {
          reportPath: '.slice/mcp/scan-123/project-results.json',
          format: 'project-results.v1',
        },
        error: null,
      },
    });

    expect(result).toMatchObject({
      schemaVersion: 'viewportable.project-agent-evidence.v1',
      mode: 'project-scan',
      summary: {
        routesChecked: 1,
        cleanRoutes: 1,
      },
      routes: [
        {
          route: '/',
          evidence: {
            schemaVersion: 'viewportable.agent-evidence.v5',
          },
        },
      ],
    });
    expect(mcpTextSummary(result)).toContain('1 route(s)');
  });

  it('marks scanner/setup failures as MCP errors while retaining stderr evidence', () => {
    const result = canonicalMcpResult({
      mode: 'scan',
      exitCode: 2,
      outcome: 'infra_failure',
      reportPath: '.slice/mcp/scan-123/results.json',
      report: null,
      stderr: 'page did not become ready',
    });

    expect(result).toMatchObject({
      schemaVersion: 'viewportable.agent-evidence.v5',
      outcome: 'infra_failure',
      exitCode: 2,
      findings: [],
      error: 'page did not become ready',
    });
  });
});
