import { describe, expect, it } from 'vitest';
import { renderGitHubSummary } from '../scripts/github-summary.mjs';

describe('GitHub summary', () => {
  it('renders failing viewports, causes, boundaries, and suppressions', () => {
    const markdown = renderGitHubSummary(
      {
        summary: {
          viewportsChecked: 2,
          suppressedIssues: 1,
        },
        viewports: [
          {
            width: 390,
            status: 'fail',
            issues: [
              {
                type: 'fixed-content-occlusion',
                selector: 'button.help',
                targetSelector: 'button.apply',
                targetCoveragePct: 63,
              },
            ],
            suppressedIssues: [],
          },
          {
            width: 768,
            status: 'pass',
            issues: [],
            suppressedIssues: [{ type: 'horizontal-overflow' }],
          },
        ],
        rootCauses: [
          {
            id: 'root-1',
            type: 'horizontal-overflow',
            selector: 'section.grid',
            boundaries: [{ boundary: 742 }],
            diagnosis: {
              property: 'width',
              value: '720px',
            },
          },
        ],
        boundaries: [
          {
            issueId: 'issue-2',
            issueType: 'fixed-content-occlusion',
            boundary: 768,
          },
        ],
      },
      {
        schemaVersion: 'viewportable.agent-evidence.v5',
        findings: [
          {
            id: 'scan-finding-1',
            groupId: 'root-1',
            repair: {
              repairable: true,
              reason: 'deterministic-authored-css',
            },
          },
        ],
      },
    );

    expect(markdown).toContain('**1 failing viewports / 2 checked** · 1 suppressed');
    expect(markdown).toContain('button.help covers button.apply (63%)');
    expect(markdown).toContain('| 768px | PASS | 1 suppressed |');
    expect(markdown).toContain('| section.grid | 742px | width: 720px | Auto-repairable |');
    expect(markdown).toContain('| issue-2 | fixed-content-occlusion | 768px |');
  });

  it('renders structural compare ranges and exact boundaries', () => {
    const markdown = renderGitHubSummary({
      baselineUrl: 'http://127.0.0.1:3000',
      candidateUrl: 'http://127.0.0.1:3001',
      summary: {
        viewportsChecked: 4,
        introducedRanges: 2,
        resolvedRanges: 0,
        exactBoundaries: 4,
      },
      viewports: [
        {
          viewport: { width: 320, height: 900 },
          changes: [],
        },
        {
          viewport: { width: 375, height: 900 },
          changes: [
            {
              kind: 'node-presence',
              direction: 'introduced',
              subject: { key: 'id:checkout-button' },
              baselineState: 'visible',
              candidateState: 'missing',
            },
            {
              kind: 'reparenting',
              direction: 'introduced',
              subject: { key: 'id:cta' },
              baselineParent: { key: 'id:pricing-card' },
              candidateParent: { key: 'id:page-root' },
            },
          ],
        },
      ],
      ranges: [
        {
          direction: 'introduced',
          firstWidth: 375,
          lastWidth: 430,
          boundaries: [
            { edge: 'lower', boundary: 350 },
            { edge: 'upper', boundary: 499 },
          ],
          change: {
            kind: 'node-presence',
            direction: 'introduced',
            subject: { key: 'id:checkout-button' },
            baselineState: 'visible',
            candidateState: 'missing',
          },
        },
        {
          direction: 'introduced',
          firstWidth: 375,
          lastWidth: 430,
          boundaries: [
            { edge: 'lower', boundary: 350 },
            { edge: 'upper', boundary: 499 },
          ],
          change: {
            kind: 'reparenting',
            direction: 'introduced',
            subject: { key: 'id:cta' },
            baselineParent: { key: 'id:pricing-card' },
            candidateParent: { key: 'id:page-root' },
          },
        },
      ],
    });

    expect(markdown).toContain('## Viewportable Engine compare');
    expect(markdown).toContain('**2 introduced ranges / 0 resolved ranges** · 4 exact boundaries');
    expect(markdown).toContain('| 320px | PASS | No structural changes |');
    expect(markdown).toContain('id:checkout-button disappeared');
    expect(markdown).toContain('id:cta reparented id:pricing-card -> id:page-root');
    expect(markdown).toContain('350-499px exact');
    expect(markdown).toContain('sampled 375-430px');
  });

  it('renders canonical wrapping findings without duplicating grouped leaves', () => {
    const markdown = renderGitHubSummary(
      {
        summary: {
          viewportsChecked: 2,
          suppressedIssues: 0,
        },
        viewports: [
          {
            width: 390,
            status: 'fail',
            issues: [
              {
                id: 'issue-1',
                type: 'wrapping',
                selector: '#terms',
                parentSelector: '#footer-links',
                rootCauseId: 'root-1',
                evidence: {
                  stableSiblingCount: 4,
                },
              },
              {
                id: 'issue-2',
                type: 'wrapping',
                selector: '#privacy',
                parentSelector: '#footer-links',
                rootCauseId: 'root-1',
                evidence: {
                  stableSiblingCount: 4,
                },
              },
            ],
            suppressedIssues: [],
          },
          {
            width: 430,
            status: 'pass',
            issues: [],
            suppressedIssues: [],
          },
        ],
        rootCauses: [
          {
            id: 'root-1',
            type: 'wrapping',
            selector: '#footer-links',
            boundaries: [],
            observations: [
              {
                viewportWidth: 390,
                issueIds: ['issue-1', 'issue-2'],
                wrappedSiblingCount: 2,
                stableSiblingCount: 4,
              },
            ],
            evidence: {
              authoredFlexWrap: true,
              transitionCount: 2,
            },
            assessment: {
              classification: 'authored-reflow-candidate',
              reasons: ['explicit-flex-wrap'],
            },
          },
        ],
        boundaries: [],
      },
      {
        schemaVersion: 'viewportable.agent-evidence.v5',
        findings: [
          {
            id: 'wrapping-finding',
            groupId: 'root-1',
            repair: {
              repairable: false,
              reason: 'unsupported-finding',
            },
          },
        ],
      },
    );

    expect(markdown).toContain(
      'wrapping: #footer-links (2 siblings wrap; 4 stay; review: authored reflow candidate)',
    );
    expect(markdown).not.toContain('wrapping: #terms wraps below siblings');
    expect(markdown).not.toContain('wrapping: #privacy wraps below siblings');
    expect(markdown).toContain(
      '| #footer-links | - | Grouped sibling wrapping · review: authored reflow candidate · 2 transitions | Manual review · unsupported-finding |',
    );
    expect(markdown).not.toContain('undefined');
  });
});
