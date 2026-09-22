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
      schemaVersion: 'viewportable.agent-evidence.v2',
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
      schemaVersion: 'viewportable.agent-evidence.v2',
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
      schemaVersion: 'viewportable.agent-evidence.v2',
      outcome: 'infra_failure',
      exitCode: 2,
      findings: [],
      error: 'page did not become ready',
    });
  });
});
