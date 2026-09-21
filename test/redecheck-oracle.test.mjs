import { describe, expect, it } from 'vitest';
import {
  classifyAntiOracleReport,
  classifyFailure,
  parseAntiOracle,
  parseOracle,
  widthsForPage,
} from '../scripts/lib/redecheck-oracle.mjs';

const archive = `### True Positives### {#TP}

| **Report Type** | **Web Page** | **Distinct RLF** | **Viewport Range** | **Classification** | **Reason** |
| Viewport Protrusion| Example | [1](../Example-failure-1.html#About-drlf) | 320px-340px | TP | viewport report |
| Small-Range| Example | [1](../Example-failure-2.html#About-drlf) | 330px-330px | TP | same distinct defect, another report type |
| Wrapping| Other | [2](../Other-failure-1.html#About-drlf) | 476px-480px | TP | wrapped |

### False Positives### {#FP}

| **Report Type** | **Web Page** | **Viewport Range** | **Classification** | **Reason** |
| Small-Range| Other | 490px-492px | FP | coincidental |

### Non-Observable Issues### {#NOI}

| **Report Type** | **Web Page** | **Viewport Range** | **Classification** | **Reason** |
| Viewport Protrusion| Example | 350px-360px | NOI | DOM overflow is not visually observable |
`;

describe('ReDeCheck benchmark oracle', () => {
  it('groups multiple report types under one Distinct RLF identity', () => {
    const failures = parseOracle(archive, { expectedDistinct: 2 });

    expect(failures).toHaveLength(2);
    expect(failures[0]).toMatchObject({
      id: 1,
      page: 'Example',
      reportTypes: ['Viewport Protrusion', 'Small-Range'],
      reports: [
        {
          type: 'Viewport Protrusion',
          range: { min: 320, max: 340 },
        },
        {
          type: 'Small-Range',
          range: { min: 330, max: 330 },
        },
      ],
    });
  });

  it('samples narrow oracle ranges directly', () => {
    const failures = parseOracle(archive, { expectedDistinct: 2 });
    const widths = widthsForPage([failures[1]]);

    expect(widths).toContain(476);
    expect(widths).toContain(478);
    expect(widths).toContain(480);
  });

  it('marks compatible report-family findings as candidates, not confirmed detections', () => {
    const [failure] = parseOracle(archive, { expectedDistinct: 2 });
    const classified = classifyFailure(failure, {
      status: 'ok',
      result: {
        viewports: [
          {
            width: 330,
            issues: [
              {
                id: 'issue-1',
                type: 'horizontal-overflow',
                selector: '.example',
              },
            ],
          },
        ],
      },
    });

    expect(classified.classification).toBe('candidate-match');
    expect(classified.support).toBe('compatible');
    expect(classified.matches).toHaveLength(1);
    expect(classified.matches[0].oracleReportTypes).toEqual(['Viewport Protrusion']);
  });

  it('treats wrapping as a compatible family once the detector exists', () => {
    const [, failure] = parseOracle(archive, { expectedDistinct: 2 });
    const classified = classifyFailure(failure, {
      status: 'ok',
      result: {
        viewports: [
          {
            width: 478,
            issues: [
              {
                id: 'issue-wrap',
                type: 'wrapping',
                selector: '.wrapped-item',
              },
            ],
          },
        ],
      },
    });

    expect(classified.classification).toBe('candidate-match');
    expect(classified.support).toBe('compatible');
    expect(classified.matches[0].oracleReportTypes).toEqual(['Wrapping']);
  });

  it('parses FP and NOI reports as a separate anti-oracle', () => {
    const reports = parseAntiOracle(archive);

    expect(reports).toHaveLength(2);
    expect(reports.map((report) => report.classification)).toEqual(['FP', 'NOI']);
  });

  it('marks comparable NOI-range findings as negative candidates', () => {
    const report = parseAntiOracle(archive).find((candidate) => candidate.classification === 'NOI');
    const classified = classifyAntiOracleReport(report, {
      status: 'ok',
      result: {
        viewports: [
          {
            width: 355,
            issues: [
              {
                id: 'issue-negative',
                type: 'horizontal-overflow',
                selector: '.not-visually-observable',
              },
            ],
          },
        ],
      },
    });

    expect(classified.classification).toBe('negative-candidate');
    expect(classified.matches).toHaveLength(1);
  });
});
