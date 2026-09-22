import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildSourceAnnotations } from '../scripts/github-annotations.mjs';
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

function attributedReport(stylesheet) {
  return {
    summary: {
      viewportsChecked: 4,
      exactBoundaries: 2,
      durationMs: 900,
    },
    findings: [
      {
        id: 'structural-protrusion',
        category: 'structural',
        type: 'protrusion',
        direction: 'introduced',
        subject: { key: 'data-testid:viewport-scroll-zone-iphone-15-pro' },
        relatedSubjects: [{ key: 'id:viewport-board' }],
        sampledRange: { minWidth: 875, maxWidth: 925, widths: [875, 925] },
        exactRange: { minWidth: 850, maxWidth: 949 },
        baseline: { state: 'contained' },
        candidate: { state: 'protruding' },
        source: {
          stylesheet,
          selector: '[data-viewport-id="iphone-15-pro"]',
          property: 'min-width',
          value: '1400px',
          media: '(min-width: 850px) and (max-width: 949px)',
          location: {
            kind: 'css-property-range',
            confidence: 'deterministic',
            coordinateSpace: 'stylesheet',
            start: { line: 2, column: 5 },
            end: { line: 2, column: 23 },
          },
        },
      },
    ],
  };
}

describe('GitHub Check Run', () => {
  it('builds a line-and-column annotation only after repository source verification', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'viewportable-annotations-'));
    const stylesheet = path.join(root, 'src/renderer/styles.css');

    try {
      await mkdir(path.dirname(stylesheet), { recursive: true });
      await writeFile(stylesheet, 'rule {\n    min-width: 1400px;\n}\n', 'utf8');

      const result = await buildSourceAnnotations(attributedReport(stylesheet), {
        repositoryRoot: root,
      });

      expect(result).toEqual({
        annotations: [
          {
            path: 'src/renderer/styles.css',
            start_line: 2,
            end_line: 2,
            start_column: 5,
            end_column: 22,
            annotation_level: 'failure',
            title: 'Viewportable: protrusion',
            message:
              '850-949px exact - data-testid:viewport-scroll-zone-iphone-15-pro in id:viewport-board',
            raw_details:
              'selector: [data-viewport-id="iphone-15-pro"]\n' +
              'declaration: min-width: 1400px\n' +
              'media: (min-width: 850px) and (max-width: 949px)',
          },
        ],
        total: 1,
        skipped: 0,
        truncated: false,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('prefers a hash-verified authored source-map path over generated CSS', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'viewportable-authored-'));
    const authoredPath = path.join(root, 'src/styles.scss');
    const authoredContent = [
      '$card-width: 1400px;',
      '',
      '.viewport {',
      '  min-width: $card-width;',
      '}',
      '',
    ].join('\n');
    const evidence = attributedReport('https://example.test/assets/app.css');
    evidence.findings[0].source.authoredLocation = {
      kind: 'source-map-property',
      confidence: 'deterministic',
      coordinateSpace: 'authored-source',
      source: '../../src/styles.scss',
      resolvedSource: 'https://example.test/src/styles.scss',
      start: { line: 4, column: 3 },
      sourceContentSha256: createHash('sha256').update(authoredContent).digest('hex'),
      sourceMap: {
        version: 3,
        kind: 'external',
        url: 'https://example.test/assets/app.css.map',
      },
    };

    try {
      await mkdir(path.dirname(authoredPath), { recursive: true });
      await writeFile(authoredPath, authoredContent, 'utf8');

      const result = await buildSourceAnnotations(evidence, {
        repositoryRoot: root,
      });

      expect(result).toMatchObject({
        annotations: [
          {
            path: 'src/styles.scss',
            start_line: 4,
            end_line: 4,
            start_column: 3,
            end_column: 11,
            annotation_level: 'failure',
            raw_details: expect.stringContaining('source-map: external -> ../../src/styles.scss'),
          },
        ],
        total: 1,
        skipped: 0,
        truncated: false,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('finds one real build-tool source by suffix plus exact content hash', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'viewportable-build-tool-source-'));
    const authoredPath = path.join(
      root,
      'test/fixtures/build-tool-source-map/src/Card.module.scss',
    );
    const authoredContent = [
      '$card-width: 1400px;',
      '',
      '.card {',
      '  min-width: $card-width;',
      '}',
      '',
    ].join('\n');
    const evidence = attributedReport('https://example.test/assets/app.css');
    evidence.findings[0].source.authoredLocation = {
      kind: 'source-map-property',
      confidence: 'deterministic',
      coordinateSpace: 'authored-source',
      source: '../../src/Card.module.scss',
      resolvedSource: 'https://example.test/src/Card.module.scss',
      start: { line: 4, column: 3 },
      sourceContentSha256: createHash('sha256').update(authoredContent).digest('hex'),
      sourceMap: {
        version: 3,
        kind: 'external',
        url: 'https://example.test/assets/app.css.map',
      },
    };

    try {
      await mkdir(path.dirname(authoredPath), { recursive: true });
      await writeFile(authoredPath, authoredContent, 'utf8');

      const result = await buildSourceAnnotations(evidence, {
        repositoryRoot: root,
      });

      expect(result).toMatchObject({
        annotations: [
          {
            path: 'test/fixtures/build-tool-source-map/src/Card.module.scss',
            start_line: 4,
            start_column: 3,
            end_column: 11,
          },
        ],
        total: 1,
        skipped: 0,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('fails closed when two checkout files match the same authored source content', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'viewportable-ambiguous-build-source-'));
    const authoredContent = '.card {\n  min-width: 1400px;\n}\n';
    const evidence = attributedReport('https://example.test/assets/app.css');
    evidence.findings[0].source.authoredLocation = {
      kind: 'source-map-property',
      confidence: 'deterministic',
      coordinateSpace: 'authored-source',
      source: '../../src/Card.module.scss',
      resolvedSource: 'https://example.test/src/Card.module.scss',
      start: { line: 2, column: 3 },
      sourceContentSha256: createHash('sha256').update(authoredContent).digest('hex'),
      sourceMap: {
        version: 3,
        kind: 'external',
        url: 'https://example.test/assets/app.css.map',
      },
    };

    try {
      for (const prefix of ['app-a', 'app-b']) {
        const candidate = path.join(root, prefix, 'src/Card.module.scss');
        await mkdir(path.dirname(candidate), { recursive: true });
        await writeFile(candidate, authoredContent, 'utf8');
      }

      const result = await buildSourceAnnotations(evidence, {
        repositoryRoot: root,
      });

      expect(result).toMatchObject({
        annotations: [],
        total: 0,
        skipped: 1,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('fails closed when the stylesheet is outside the candidate checkout', async () => {
    const result = await buildSourceAnnotations(attributedReport('/other/src/styles.css'), {
      repositoryRoot: '/workspace/candidate',
      readText: async () => '    min-width: 1400px;\n',
    });

    expect(result).toMatchObject({
      annotations: [],
      total: 0,
      skipped: 1,
      truncated: false,
    });
  });

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

  it('publishes verified source annotations in the managed Check Run', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'viewportable-check-'));
    const stylesheet = path.join(root, 'src/renderer/styles.css');
    const calls = [];

    try {
      await mkdir(path.dirname(stylesheet), { recursive: true });
      await writeFile(stylesheet, 'rule {\n    min-width: 1400px;\n}\n', 'utf8');

      const request = async (apiPath, options = {}) => {
        calls.push({ path: apiPath, options });
        if (options.method === 'POST') {
          return {
            id: 101,
            html_url: 'https://github.com/example/repo/runs/101',
          };
        }
        return { check_runs: [] };
      };

      await upsertCheckRun({
        repository: 'example/repo',
        pullRequestNumber: 7,
        headSha: 'abc123',
        exitCode: 1,
        report: attributedReport(stylesheet),
        repositoryRoot: root,
        token: 'token',
        request,
      });

      expect(calls[1].options.body.output.annotations).toEqual([
        expect.objectContaining({
          path: 'src/renderer/styles.css',
          start_line: 2,
          end_line: 2,
          start_column: 5,
          end_column: 22,
          annotation_level: 'failure',
        }),
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('does not append source annotations again when the managed check already has them', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'viewportable-rerun-'));
    const stylesheet = path.join(root, 'src/renderer/styles.css');
    const calls = [];

    try {
      await mkdir(path.dirname(stylesheet), { recursive: true });
      await writeFile(stylesheet, 'rule {\n    min-width: 1400px;\n}\n', 'utf8');

      const request = async (apiPath, options = {}) => {
        calls.push({ path: apiPath, options });
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
              external_id: 'viewportable-engine:pr:7:head:abc123',
              html_url: 'https://github.com/example/repo/runs/42',
              output: { annotations_count: 1 },
            },
          ],
        };
      };

      await upsertCheckRun({
        repository: 'example/repo',
        pullRequestNumber: 7,
        headSha: 'abc123',
        exitCode: 1,
        report: attributedReport(stylesheet),
        repositoryRoot: root,
        token: 'token',
        request,
      });

      expect(calls[1].options.body.output.annotations).toBeUndefined();
      expect(calls[1].options.body.output.title).toBe('1 structural regression introduced');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
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
