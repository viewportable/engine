import { describe, expect, it } from 'vitest';
import {
  PR_COMMENT_MARKER,
  renderPullRequestComment,
  upsertPullRequestComment,
} from '../scripts/github-pr-comment.mjs';

function agentEvidence() {
  return {
    schemaVersion: 'viewportable.agent-evidence.v5',
    findings: [
      {
        id: 'structural-a',
        repair: {
          repairable: false,
          reason: 'unsupported-finding',
        },
      },
      {
        id: 'structural-b',
        repair: {
          repairable: false,
          reason: 'unsupported-finding',
        },
      },
    ],
  };
}

function report() {
  return {
    summary: {
      viewportsChecked: 4,
      durationMs: 1234,
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

describe('GitHub pull request evidence', () => {
  it('renders canonical findings with revision and artifact evidence', () => {
    const markdown = renderPullRequestComment(
      report(),
      {
        artifactUrl: 'https://github.com/example/actions/runs/1/artifacts/2',
        baselineSha: '111111111111aaaaaaaa',
        candidateSha: '222222222222bbbbbbbb',
        engineRef: 'v0.1.0-rc.1',
      },
      agentEvidence(),
    );

    expect(markdown).toContain(PR_COMMENT_MARKER);
    expect(markdown).toContain('2 structural regressions introduced');
    expect(markdown).toContain('Repair policy:** 0 auto-repairable · 2 manual review');
    expect(markdown).toContain('Manual review · unsupported-finding');
    expect(markdown).toContain('350-499px exact');
    expect(markdown).toContain('id:checkout-button disappeared');
    expect(markdown).toContain('visible');
    expect(markdown).toContain('missing');
    expect(markdown).toContain('id:cta reparented');
    expect(markdown).toContain('parented: id:pricing-card');
    expect(markdown).toContain('parented: id:page-root');
    expect(markdown).toContain('[Open structural-diff.json artifact]');
    expect(markdown).toContain('baseline `111111111111`');
    expect(markdown).toContain('candidate `222222222222`');
    expect(markdown).toContain('engine `v0.1.0-rc.1`');
    expect(markdown).toContain('4 viewports');
    expect(markdown).toContain('1.2s');
  });

  it('updates the existing managed comment instead of creating another one', async () => {
    const calls = [];
    const request = async (path, options = {}) => {
      calls.push({ path, options });

      if (options.method === 'PATCH') {
        return {
          id: 42,
          html_url: 'https://github.com/example/repo/pull/7#issuecomment-42',
        };
      }

      return [
        {
          id: 42,
          body: `${PR_COMMENT_MARKER}\nold evidence`,
          html_url: 'https://github.com/example/repo/pull/7#issuecomment-42',
        },
      ];
    };

    const result = await upsertPullRequestComment({
      repository: 'example/repo',
      pullRequestNumber: 7,
      body: renderPullRequestComment(report()),
      token: 'token',
      request,
    });

    expect(result).toEqual({
      action: 'updated',
      url: 'https://github.com/example/repo/pull/7#issuecomment-42',
      id: 42,
    });
    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatchObject({
      path: '/repos/example/repo/issues/comments/42',
      options: {
        method: 'PATCH',
      },
    });
  });

  it('creates the managed comment when none exists', async () => {
    const calls = [];
    const request = async (path, options = {}) => {
      calls.push({ path, options });

      if (options.method === 'POST') {
        return {
          id: 99,
          html_url: 'https://github.com/example/repo/pull/7#issuecomment-99',
        };
      }

      return [];
    };

    const result = await upsertPullRequestComment({
      repository: 'example/repo',
      pullRequestNumber: 7,
      body: renderPullRequestComment(report()),
      token: 'token',
      request,
    });

    expect(result.action).toBe('created');
    expect(result.id).toBe(99);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatchObject({
      path: '/repos/example/repo/issues/7/comments',
      options: {
        method: 'POST',
      },
    });
  });
});
