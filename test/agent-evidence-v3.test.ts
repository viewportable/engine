import { describe, expect, it } from 'vitest';
import {
  AGENT_EVIDENCE_SCHEMA_VERSION_V3,
  AgentEvidenceV3Schema,
  agentEvidenceV3JsonSchema,
} from '../src/contracts/agent-evidence-v3.js';
import { buildCanonicalAgentEvidenceV3 } from '../src/contracts/build-agent-evidence-v3.js';
import type { EngineMcpRun } from '../src/mcp-runner.js';

function compareRun(): EngineMcpRun {
  return {
    mode: 'compare',
    exitCode: 1,
    outcome: 'findings',
    reportPath: '.slice/compare/structural-diff.json',
    stderr: '',
    report: {
      summary: {
        viewportsChecked: 4,
        resolvedRanges: 0,
        durationMs: 811,
      },
      findings: [
        {
          id: 'structural-protrusion',
          type: 'protrusion',
          direction: 'introduced',
          subject: {
            key: 'data-testid:viewport-scroll-zone-iphone-15-pro',
            quality: 'explicit',
            tagName: 'DIV',
          },
          relatedSubjects: [],
          sampledRange: {
            minWidth: 875,
            maxWidth: 925,
            widths: [875, 925],
          },
          exactRange: {
            minWidth: 850,
            maxWidth: 949,
          },
          baseline: {
            state: 'contained',
          },
          candidate: {
            state: 'protruding',
          },
          source: {
            stylesheet: '/workspace/src/renderer/styles.css',
            selector: '[data-viewport-id="iphone-15-pro"]',
            property: 'min-width',
            value: '1400px',
            media: '(min-width: 850px) and (max-width: 949px)',
            location: {
              kind: 'css-property-range',
              confidence: 'deterministic',
              coordinateSpace: 'stylesheet',
              start: {
                line: 572,
                column: 5,
              },
              end: {
                line: 572,
                column: 23,
              },
            },
          },
        },
      ],
    },
  };
}

describe('Viewportable Canonical Agent Evidence Contract V3', () => {
  it('adds deterministic stylesheet coordinates without changing V2 source semantics', () => {
    const result = buildCanonicalAgentEvidenceV3(compareRun());

    expect(result).toMatchObject({
      schemaVersion: AGENT_EVIDENCE_SCHEMA_VERSION_V3,
      mode: 'compare',
      outcome: 'findings',
      findings: [
        {
          type: 'protrusion',
          source: {
            kind: 'css-declaration',
            confidence: 'deterministic',
            stylesheet: '/workspace/src/renderer/styles.css',
            selector: '[data-viewport-id="iphone-15-pro"]',
            property: 'min-width',
            value: '1400px',
            media: '(min-width: 850px) and (max-width: 949px)',
            location: {
              kind: 'css-property-range',
              confidence: 'deterministic',
              coordinateSpace: 'stylesheet',
              start: {
                line: 572,
                column: 5,
              },
              end: {
                line: 572,
                column: 23,
              },
            },
          },
        },
      ],
    });
  });

  it('keeps location null when CDP cannot prove a unique range', () => {
    const run = compareRun();
    const report = run.report as { findings: Array<Record<string, unknown>> };
    const source = report.findings[0]?.source as Record<string, unknown>;
    report.findings[0] = {
      ...report.findings[0],
      source: {
        ...source,
        location: null,
      },
    };

    const result = buildCanonicalAgentEvidenceV3(run);
    expect(result.findings[0]?.source?.location).toBeNull();
  });

  it('maps scan root-cause source location onto grouped findings', () => {
    const result = buildCanonicalAgentEvidenceV3({
      mode: 'scan',
      exitCode: 1,
      outcome: 'findings',
      reportPath: '.slice/results.json',
      stderr: '',
      report: {
        summary: {
          viewportsChecked: 1,
          durationMs: 120,
        },
        viewports: [
          {
            width: 390,
            status: 'fail',
            issues: [
              {
                id: 'issue-1',
                type: 'horizontal-overflow',
                selector: '.grid',
                tagName: 'SECTION',
                rootCauseId: 'root-1',
              },
            ],
          },
        ],
        rootCauses: [
          {
            id: 'root-1',
            diagnosis: {
              source: {
                stylesheet: '/src/app.css',
                selector: '.grid',
                property: 'min-width',
                value: '700px',
                media: null,
                location: {
                  kind: 'css-property-range',
                  confidence: 'deterministic',
                  coordinateSpace: 'stylesheet',
                  start: { line: 8, column: 5 },
                  end: { line: 8, column: 14 },
                },
              },
            },
          },
        ],
      },
    });

    expect(result.findings[0]?.source?.location).toEqual({
      kind: 'css-property-range',
      confidence: 'deterministic',
      coordinateSpace: 'stylesheet',
      start: { line: 8, column: 5 },
      end: { line: 8, column: 14 },
    });
  });

  it('keeps V3 strict at location boundaries', () => {
    const valid = buildCanonicalAgentEvidenceV3(compareRun());
    const finding = valid.findings[0];

    expect(
      AgentEvidenceV3Schema.safeParse({
        ...valid,
        findings: [
          {
            ...finding,
            source: {
              ...finding?.source,
              location: {
                ...finding?.source?.location,
                guessedFileLine: 572,
              },
            },
          },
        ],
      }).success,
    ).toBe(false);
  });

  it('exports strict V3 JSON Schema', () => {
    expect(agentEvidenceV3JsonSchema()).toMatchObject({
      type: 'object',
      additionalProperties: false,
      properties: {
        schemaVersion: {
          const: AGENT_EVIDENCE_SCHEMA_VERSION_V3,
        },
      },
    });
  });
});
