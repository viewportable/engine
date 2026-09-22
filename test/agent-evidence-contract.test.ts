import { describe, expect, it } from 'vitest';
import {
  AGENT_EVIDENCE_SCHEMA_VERSION,
  AgentEvidenceV1Schema,
  agentEvidenceV1JsonSchema,
} from '../src/contracts/agent-evidence.js';
import { buildCanonicalAgentEvidenceV1 } from '../src/contracts/build-agent-evidence.js';
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
        introducedRanges: 2,
        resolvedRanges: 1,
        durationMs: 942,
      },
      findings: [
        {
          id: 'structural-disappearance',
          category: 'structural',
          type: 'disappearance',
          direction: 'introduced',
          subject: {
            key: 'id:checkout-button',
            quality: 'explicit',
            tagName: 'BUTTON',
          },
          relatedSubjects: [],
          sampledRange: {
            minWidth: 375,
            maxWidth: 430,
            widths: [375, 430],
          },
          exactRange: {
            minWidth: 350,
            maxWidth: 499,
          },
          baseline: {
            state: 'visible',
          },
          candidate: {
            state: 'missing',
          },
        },
        {
          id: 'structural-reparenting',
          category: 'structural',
          type: 'reparenting',
          direction: 'introduced',
          subject: {
            key: 'id:cta',
            quality: 'explicit',
            tagName: 'BUTTON',
          },
          relatedSubjects: [
            {
              key: 'id:pricing-card',
              quality: 'explicit',
              tagName: 'SECTION',
            },
            {
              key: 'id:page-root',
              quality: 'explicit',
              tagName: 'MAIN',
            },
          ],
          sampledRange: {
            minWidth: 375,
            maxWidth: 430,
            widths: [375, 430],
          },
          exactRange: {
            minWidth: 350,
            maxWidth: 499,
          },
          baseline: {
            state: 'parented',
            parent: {
              key: 'id:pricing-card',
              quality: 'explicit',
              tagName: 'SECTION',
            },
          },
          candidate: {
            state: 'parented',
            parent: {
              key: 'id:page-root',
              quality: 'explicit',
              tagName: 'MAIN',
            },
          },
        },
        {
          id: 'resolved-appearance',
          category: 'structural',
          type: 'appearance',
          direction: 'resolved',
          subject: {
            key: 'id:legacy',
            quality: 'explicit',
            tagName: 'DIV',
          },
          relatedSubjects: [],
          sampledRange: {
            minWidth: 375,
            maxWidth: 375,
            widths: [375],
          },
          exactRange: null,
          baseline: {
            state: 'missing',
          },
          candidate: {
            state: 'visible',
          },
        },
      ],
    },
  };
}

describe('Viewportable Canonical Agent Evidence Contract V1', () => {
  it('normalizes compare reports into strict semantic evidence', () => {
    const result = buildCanonicalAgentEvidenceV1(compareRun());

    expect(result).toEqual({
      schemaVersion: AGENT_EVIDENCE_SCHEMA_VERSION,
      mode: 'compare',
      outcome: 'findings',
      exitCode: 1,
      summary: {
        viewportsChecked: 4,
        findingCount: 2,
        introducedCount: 2,
        resolvedCount: 1,
        durationMs: 942,
      },
      findings: [
        {
          id: 'structural-disappearance',
          category: 'structural',
          type: 'disappearance',
          direction: 'introduced',
          groupId: null,
          subject: {
            identity: 'id:checkout-button',
            tagName: 'BUTTON',
            matchQuality: 'explicit',
          },
          relatedSubjects: [],
          range: {
            kind: 'exact',
            minWidth: 350,
            maxWidth: 499,
            sampledMinWidth: 375,
            sampledMaxWidth: 430,
            viewportWidth: null,
          },
          baseline: {
            state: 'visible',
            parent: null,
          },
          candidate: {
            state: 'missing',
            parent: null,
          },
        },
        expect.objectContaining({
          id: 'structural-reparenting',
          type: 'reparenting',
          baseline: {
            state: 'parented',
            parent: {
              identity: 'id:pricing-card',
              tagName: 'SECTION',
              matchQuality: 'explicit',
            },
          },
          candidate: {
            state: 'parented',
            parent: {
              identity: 'id:page-root',
              tagName: 'MAIN',
              matchQuality: 'explicit',
            },
          },
        }),
      ],
      evidence: {
        reportPath: '.slice/compare/structural-diff.json',
        format: 'structural-diff.v1',
      },
      error: null,
    });
  });

  it('normalizes scan issues into the same finding language', () => {
    const result = buildCanonicalAgentEvidenceV1({
      mode: 'scan',
      exitCode: 1,
      outcome: 'findings',
      reportPath: '.slice/scan/results.json',
      stderr: '',
      report: {
        summary: {
          viewportsChecked: 2,
          durationMs: 315,
        },
        viewports: [
          {
            width: 390,
            status: 'fail',
            issues: [
              {
                id: 'overflow-1',
                type: 'horizontal-overflow',
                selector: '#pricing-card',
                tagName: 'SECTION',
                rootCauseId: 'root-pricing-card',
              },
              {
                id: 'wrap-1',
                type: 'wrapping',
                selector: '#actions',
                tagName: 'DIV',
                parentSelector: '#toolbar',
                parentTagName: 'NAV',
              },
            ],
          },
          {
            width: 768,
            status: 'pass',
            issues: [],
          },
        ],
      },
    });

    expect(result).toMatchObject({
      schemaVersion: AGENT_EVIDENCE_SCHEMA_VERSION,
      mode: 'scan',
      outcome: 'findings',
      summary: {
        viewportsChecked: 2,
        findingCount: 2,
        introducedCount: 0,
        resolvedCount: 0,
        durationMs: 315,
      },
      findings: [
        {
          id: 'overflow-1',
          category: 'layout',
          type: 'horizontal-overflow',
          direction: 'current',
          groupId: 'root-pricing-card',
          subject: {
            identity: '#pricing-card',
            tagName: 'SECTION',
            matchQuality: null,
          },
          range: {
            kind: 'viewport',
            viewportWidth: 390,
          },
        },
        {
          id: 'wrap-1',
          type: 'wrapping',
          relatedSubjects: [
            {
              identity: '#toolbar',
              tagName: 'NAV',
              matchQuality: null,
            },
          ],
        },
      ],
      evidence: {
        format: 'results.v1',
      },
      error: null,
    });
  });

  it('represents Engine/setup failure without inventing findings', () => {
    const result = buildCanonicalAgentEvidenceV1({
      mode: 'compare',
      exitCode: 2,
      outcome: 'infra_failure',
      reportPath: '.slice/compare/structural-diff.json',
      report: null,
      stderr: 'candidate did not become ready',
    });

    expect(result).toEqual({
      schemaVersion: AGENT_EVIDENCE_SCHEMA_VERSION,
      mode: 'compare',
      outcome: 'infra_failure',
      exitCode: 2,
      summary: {
        viewportsChecked: 0,
        findingCount: 0,
        introducedCount: 0,
        resolvedCount: 0,
        durationMs: null,
      },
      findings: [],
      evidence: {
        reportPath: '.slice/compare/structural-diff.json',
        format: 'structural-diff.v1',
      },
      error: 'candidate did not become ready',
    });
  });

  it('rejects unknown fields at the contract boundary', () => {
    const valid = buildCanonicalAgentEvidenceV1(compareRun());

    expect(
      AgentEvidenceV1Schema.safeParse({
        ...valid,
        accidentalField: true,
      }).success,
    ).toBe(false);

    expect(
      AgentEvidenceV1Schema.safeParse({
        ...valid,
        summary: {
          ...valid.summary,
          accidentalField: true,
        },
      }).success,
    ).toBe(false);

    expect(
      AgentEvidenceV1Schema.safeParse({
        ...valid,
        findings: [
          {
            ...valid.findings[0],
            accidentalField: true,
          },
        ],
      }).success,
    ).toBe(false);
  });

  it('exports a JSON Schema that forbids unknown top-level properties', () => {
    const schema = agentEvidenceV1JsonSchema();

    expect(schema).toMatchObject({
      type: 'object',
      additionalProperties: false,
      properties: {
        schemaVersion: {
          const: AGENT_EVIDENCE_SCHEMA_VERSION,
        },
      },
    });
  });
});
