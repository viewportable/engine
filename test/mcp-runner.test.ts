import { describe, expect, it } from 'vitest';
import {
  buildEngineArgs,
  compactMcpResult,
  mcpTextSummary,
  type EngineMcpRun,
} from '../src/mcp-runner.js';

describe('Viewportable MCP runner', () => {
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

    const result = compactMcpResult(run);

    expect(result).toMatchObject({
      mode: 'compare',
      outcome: 'findings',
      exitCode: 1,
      reportPath: '.slice/mcp/compare-123/structural-diff.json',
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
        },
      ],
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

    const result = compactMcpResult(run);

    expect(result).toMatchObject({
      mode: 'scan',
      outcome: 'findings',
      rootCauses: [{ id: 'root-1', type: 'horizontal-overflow' }],
      failingViewports: [{ width: 390, status: 'fail' }],
    });
    expect(mcpTextSummary(result)).toContain('1 failing viewport(s)');
  });

  it('marks scanner/setup failures as MCP errors while retaining stderr evidence', () => {
    const result = compactMcpResult({
      mode: 'scan',
      exitCode: 2,
      outcome: 'infra_failure',
      reportPath: '.slice/mcp/scan-123/results.json',
      report: null,
      stderr: 'page did not become ready',
    });

    expect(result).toMatchObject({
      outcome: 'infra_failure',
      exitCode: 2,
      stderr: 'page did not become ready',
    });
  });
});
