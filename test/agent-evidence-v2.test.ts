import { describe, expect, it } from 'vitest';
import {
  AGENT_EVIDENCE_SCHEMA_VERSION_V2,
  AgentEvidenceV2Schema,
  agentEvidenceV2JsonSchema,
} from '../src/contracts/agent-evidence-v2.js';
import { buildCanonicalAgentEvidenceV2 } from '../src/contracts/build-agent-evidence-v2.js';
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
          relatedSubjects: [
            {
              key: 'data-testid:device-card-iphone-15-pro',
              quality: 'explicit',
              tagName: 'SECTION',
            },
          ],
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
            parent: {
              key: 'data-testid:device-card-iphone-15-pro',
              quality: 'explicit',
              tagName: 'SECTION',
            },
          },
          candidate: {
            state: 'protruding',
            parent: {
              key: 'data-testid:device-card-iphone-15-pro',
              quality: 'explicit',
              tagName: 'SECTION',
            },
          },
          source: {
            stylesheet: '/workspace/src/renderer/styles.css',
            selector: '[data-viewport-id="iphone-15-pro"]',
            property: 'min-width',
            value: '800px',
            media: '(min-width: 850px) and (max-width: 949px)',
          },
        },
      ],
    },
  };
}

describe('Viewportable Canonical Agent Evidence Contract V2', () => {
  it('adds deterministic CSS source attribution without changing finding semantics', () => {
    const result = buildCanonicalAgentEvidenceV2(compareRun());

    expect(result).toMatchObject({
      schemaVersion: AGENT_EVIDENCE_SCHEMA_VERSION_V2,
      mode: 'compare',
      outcome: 'findings',
      exitCode: 1,
      summary: {
        viewportsChecked: 4,
        findingCount: 1,
        introducedCount: 1,
        resolvedCount: 0,
        durationMs: 811,
      },
      findings: [
        {
          id: 'structural-protrusion',
          type: 'protrusion',
          direction: 'introduced',
          range: {
            kind: 'exact',
            minWidth: 850,
            maxWidth: 949,
          },
          source: {
            kind: 'css-declaration',
            confidence: 'deterministic',
            stylesheet: '/workspace/src/renderer/styles.css',
            selector: '[data-viewport-id="iphone-15-pro"]',
            property: 'min-width',
            value: '800px',
            media: '(min-width: 850px) and (max-width: 949px)',
          },
        },
      ],
    });
  });

  it('keeps source null when no unique authored declaration is proven', () => {
    const run = compareRun();
    const report = run.report as { findings: Array<Record<string, unknown>> };
    report.findings[0] = {
      ...report.findings[0],
      source: null,
    };

    const result = buildCanonicalAgentEvidenceV2(run);

    expect(result.findings[0]?.source).toBeNull();
  });

  it('maps scan root-cause diagnosis source onto grouped layout findings', () => {
    const result = buildCanonicalAgentEvidenceV2({
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
              },
            },
          },
        ],
      },
    });

    expect(result.findings[0]?.source).toEqual({
      kind: 'css-declaration',
      confidence: 'deterministic',
      stylesheet: '/src/app.css',
      selector: '.grid',
      property: 'min-width',
      value: '700px',
      media: null,
    });
  });

  it('rejects unknown fields inside source attribution', () => {
    const valid = buildCanonicalAgentEvidenceV2(compareRun());
    const finding = valid.findings[0];
    expect(finding?.source).not.toBeNull();

    expect(
      AgentEvidenceV2Schema.safeParse({
        ...valid,
        findings: [
          {
            ...finding,
            source: {
              ...finding?.source,
              guessedLine: 42,
            },
          },
        ],
      }).success,
    ).toBe(false);
  });

  it('exports strict V2 JSON Schema', () => {
    expect(agentEvidenceV2JsonSchema()).toMatchObject({
      type: 'object',
      additionalProperties: false,
      properties: {
        schemaVersion: {
          const: AGENT_EVIDENCE_SCHEMA_VERSION_V2,
        },
      },
    });
  });
});
