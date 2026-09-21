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

  it('renders wrapping issues and canonical wrapping groups', () => {
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
              type: 'wrapping',
              selector: '#terms',
              parentSelector: '#footer-links',
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
          type: 'wrapping',
          selector: '#footer-links',
          boundaries: [],
          evidence: {
            authoredFlexWrap: true,
            transitionCount: 2,
          },
        },
      ],
      boundaries: [],
    });

    expect(markdown).toContain('wrapping: #terms wraps below siblings (4 stay)');
    expect(markdown).toContain(
      '| #footer-links | - | Grouped sibling wrapping · authored flex-wrap · 2 transitions |',
    );
    expect(markdown).not.toContain('undefined');
  });
});
