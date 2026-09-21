import { describe, expect, it } from 'vitest';
import {
  CHECK_RUN_NAME,
  checkConclusion,
  renderCheckOutput,
  upsertCheckRun,
} from '../scripts/github-check-run.mjs';

function report() {
  return {
    summary: {
      viewportsChecked: 4,
      exactBoundaries: 4,
      durationMs: 1250,
    },
    findings: [
      {
        id: 'structural-a',
        category: 'structural',
        type: 'disappearance',
        direction: 'introduced',
        subject: { key: 'id:checkout-button' },
        relatedSubjects: [],
        sampledRange: { minWidth: 375, maxWidth: 430, widths: [375, 430] },
        exactRange: { minWidth: 350, maxWidth: 499 },
        baseline: { state: 'visible' },
        candidate: { state: 'missing' },
      },
      {
        id: 'structural-b',
        category: 'structural',
        type: 'reparenting',
        direction: 'introduced',
        subject: { key: 'id:cta' },
        relatedSubjects: [{ key: 'id:pricing-card' }, { key: 'id:page-root' }],
        sampledRange: { minWidth: 375, maxWidth: 430, widths: [375, 430] },
        exactRange: { minWidth: 350, maxWidth: 499 },
        baseline: {
          state: 'parented',
          parent: { key: 'id:pricing-card' },
        },
        candidate: {
          state: 'parented',
          parent: { key: 'id:page-root' },
        },
      },
    ],
  };
}

describe('GitHub Check Run', () => {
  it('maps Engine exit codes to check conclusions', () => {
    expect(checkConclusion(0)).toBe('success');
    expect(checkConclusion(1)).toBe('failure');
    expect(checkConclusion(2)).toBe('action_required');
    expect(checkConclusion(undefined)).toBe('action_required');
  });

  it('renders compact failing evidence from canonical findings', () => {
    const output = renderCheckOutput(report(), 1);

    expect(output.title).toBe('2 structural regressions introduced');
    expect(output.summary).toContain('2 structural regressions introduced');
    expect(output.summary).toContain('350-499px exact');
    expect(output.summary).toContain('id:checkout-button disappeared');
    expect(output.summary).toContain('id:cta reparented');
    expect(output.summary).toContain('4 viewports');
    expect(output.summary).toContain('4 exact boundaries');
    expect(output.summary).toContain('1.3s');
  });

  it('renders success when no introduced canonical findings exist', () => {
    const clean = report();
    clean.findings = [];

    expect(renderCheckOutput(clean, 0)).toEqual({
      title: 'No structural regressions',
      summary:
        '✅ No structural regressions introduced.\n\n_4 viewports · 4 exact boundaries · 1.3s_',
    });
  });

  it('renders scanner/setup failure without requiring a report', () => {
    expect(renderCheckOutput(null, 2)).toEqual({
      title: 'Comparison could not complete',
      summary:
        'Viewportable Engine could not complete structural comparison. Review the workflow logs and retry after fixing the scanner or application setup failure.',
    });
  });

  it('updates the existing check for the same PR head instead of duplicating it', async () => {
    const calls = [];
    const externalId = 'viewportable-engine:pr:7:head:abc123';
    const request = async (path, options = {}) => {
      calls.push({ path, options });

      if (options.method === 'PATCH') {
        return {
          id: 42,
          html_url: 'https://github.com/example/repo/runs/42',
        };
      }

      return {
        check_runs: [
          {
            id: 42,
            name: CHECK_RUN_NAME,
            external_id: externalId,
            html_url: 'https://github.com/example/repo/runs/42',
          },
        ],
      };
    };

    const result = await upsertCheckRun({
      repository: 'example/repo',
      pullRequestNumber: 7,
      headSha: 'abc123',
      exitCode: 1,
      report: report(),
      detailsUrl: 'https://github.com/example/repo/actions/runs/1',
      token: 'token',
      request,
    });

    expect(result).toEqual({
      action: 'updated',
      id: 42,
      url: 'https://github.com/example/repo/runs/42',
      conclusion: 'failure',
    });
    expect(calls).toHaveLength(2);
    expect(calls[0].path).toContain('/commits/abc123/check-runs');
    expect(calls[1]).toMatchObject({
      path: '/repos/example/repo/check-runs/42',
      options: {
        method: 'PATCH',
        body: {
          name: CHECK_RUN_NAME,
          status: 'completed',
          conclusion: 'failure',
          external_id: externalId,
          details_url: 'https://github.com/example/repo/actions/runs/1',
        },
      },
    });
  });

  it('creates a check when the candidate head has no managed check yet', async () => {
    const calls = [];
    const request = async (path, options = {}) => {
      calls.push({ path, options });

      if (options.method === 'POST') {
        return {
          id: 99,
          html_url: 'https://github.com/example/repo/runs/99',
        };
      }

      return { check_runs: [] };
    };

    const result = await upsertCheckRun({
      repository: 'example/repo',
      pullRequestNumber: 7,
      headSha: 'abc123',
      exitCode: 0,
      report: { ...report(), findings: [] },
      token: 'token',
      request,
    });

    expect(result.action).toBe('created');
    expect(result.id).toBe(99);
    expect(result.conclusion).toBe('success');
    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatchObject({
      path: '/repos/example/repo/check-runs',
      options: {
        method: 'POST',
        body: {
          name: CHECK_RUN_NAME,
          head_sha: 'abc123',
          status: 'completed',
          conclusion: 'success',
          external_id: 'viewportable-engine:pr:7:head:abc123',
        },
      },
    });
  });
});
