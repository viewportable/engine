import { describe, expect, it } from 'vitest';
import { renderGitHubSummary } from '../scripts/github-summary.mjs';

describe('GitHub summary', () => {
  it('renders failing viewports, causes, boundaries, and suppressions', () => {
    const markdown = renderGitHubSummary({
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
    });

    expect(markdown).toContain('**1 failing viewports / 2 checked** · 1 suppressed');
    expect(markdown).toContain('button.help covers button.apply (63%)');
    expect(markdown).toContain('| 768px | PASS | 1 suppressed |');
    expect(markdown).toContain('| section.grid | 742px | width: 720px |');
    expect(markdown).toContain('| issue-2 | fixed-content-occlusion | 768px |');
  });

  it('renders canonical wrapping findings without duplicating grouped leaves', () => {
    const markdown = renderGitHubSummary({
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
    });

    expect(markdown).toContain(
      'wrapping: #footer-links (2 siblings wrap; 4 stay; review: authored reflow candidate)',
    );
    expect(markdown).not.toContain('wrapping: #terms wraps below siblings');
    expect(markdown).not.toContain('wrapping: #privacy wraps below siblings');
    expect(markdown).toContain(
      '| #footer-links | - | Grouped sibling wrapping · review: authored reflow candidate · 2 transitions |',
    );
    expect(markdown).not.toContain('undefined');
  });
});
