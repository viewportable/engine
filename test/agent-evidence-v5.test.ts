import { describe, expect, it } from 'vitest';
import {
  AGENT_EVIDENCE_SCHEMA_VERSION_V5,
  AgentEvidenceV5Schema,
  agentEvidenceV5JsonSchema,
} from '../src/contracts/agent-evidence-v5.js';
import { buildCanonicalAgentEvidenceV5 } from '../src/contracts/build-agent-evidence-v5.js';
import type { EngineMcpRun } from '../src/mcp-runner.js';

const authoredSource = {
  stylesheet: 'https://example.test/assets/app.css',
  selector: '#subject',
  property: 'min-width',
  value: '400px',
  media: null,
  location: {
    kind: 'css-property-range',
    confidence: 'deterministic',
    coordinateSpace: 'stylesheet',
    start: { line: 6, column: 5 },
    end: { line: 6, column: 22 },
  },
  authoredLocation: {
    kind: 'source-map-property',
    confidence: 'deterministic',
    coordinateSpace: 'authored-source',
    source: '../../src/subject.scss',
    resolvedSource: 'https://example.test/src/subject.scss',
    start: { line: 18, column: 5 },
    sourceContentSha256:
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    sourceMap: {
      version: 3,
      kind: 'external',
      url: 'https://example.test/assets/app.css.map',
    },
  },
};

function compareRun(source = authoredSource, type = 'protrusion'): EngineMcpRun {
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
          id: 'finding-1',
          type,
          direction: 'introduced',
          subject: {
            key: 'id:subject',
            quality: 'explicit',
            tagName: 'DIV',
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
          baseline: { state: 'contained' },
          candidate: { state: 'protruding' },
          source,
        },
      ],
    },
  };
}

function scanRun(): EngineMcpRun {
  return {
    mode: 'scan',
    exitCode: 1,
    outcome: 'findings',
    reportPath: '.slice/scan/results.json',
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
              selector: '#subject',
              tagName: 'DIV',
              rootCauseId: 'root-1',
            },
          ],
        },
      ],
      rootCauses: [
        {
          id: 'root-1',
          diagnosis: {
            source: authoredSource,
          },
        },
      ],
    },
  };
}

describe('Viewportable Canonical Agent Evidence Contract V5', () => {
  it('marks deterministic authored compare protrusions as repairable', () => {
    const result = buildCanonicalAgentEvidenceV5(compareRun());

    expect(result).toMatchObject({
      schemaVersion: AGENT_EVIDENCE_SCHEMA_VERSION_V5,
      findings: [
        {
          type: 'protrusion',
          repair: {
            repairable: true,
            reason: 'deterministic-authored-css',
          },
        },
      ],
    });
  });

  it('marks deterministic authored scan overflow root causes as repairable', () => {
    const result = buildCanonicalAgentEvidenceV5(scanRun());

    expect(result.findings[0]).toMatchObject({
      type: 'horizontal-overflow',
      direction: 'current',
      repair: {
        repairable: true,
        reason: 'deterministic-authored-css',
      },
    });
  });

  it('refuses unsupported finding types before considering source evidence', () => {
    const result = buildCanonicalAgentEvidenceV5(compareRun(null, 'disappearance'));

    expect(result.findings[0]?.repair).toEqual({
      repairable: false,
      reason: 'unsupported-finding',
    });
  });

  it('refuses supported findings without deterministic source attribution', () => {
    const result = buildCanonicalAgentEvidenceV5(compareRun(null));

    expect(result.findings[0]?.repair).toEqual({
      repairable: false,
      reason: 'missing-deterministic-source',
    });
  });

  it('refuses supported findings without browser-proven stylesheet coordinates', () => {
    const result = buildCanonicalAgentEvidenceV5(
      compareRun({
        ...authoredSource,
        location: null,
        authoredLocation: null,
      }),
    );

    expect(result.findings[0]?.repair).toEqual({
      repairable: false,
      reason: 'missing-stylesheet-location',
    });
  });

  it('refuses supported findings without authored source-map coordinates', () => {
    const result = buildCanonicalAgentEvidenceV5(
      compareRun({
        ...authoredSource,
        authoredLocation: null,
      }),
    );

    expect(result.findings[0]?.repair).toEqual({
      repairable: false,
      reason: 'missing-authored-location',
    });
  });

  it('keeps repair status and reason combinations strict', () => {
    const valid = buildCanonicalAgentEvidenceV5(compareRun());
    const finding = valid.findings[0];

    expect(
      AgentEvidenceV5Schema.safeParse({
        ...valid,
        findings: [
          {
            ...finding,
            repair: {
              repairable: true,
              reason: 'missing-authored-location',
            },
          },
        ],
      }).success,
    ).toBe(false);
  });

  it('exports strict V5 JSON Schema', () => {
    expect(agentEvidenceV5JsonSchema()).toMatchObject({
      type: 'object',
      additionalProperties: false,
      properties: {
        schemaVersion: {
          const: AGENT_EVIDENCE_SCHEMA_VERSION_V5,
        },
      },
    });
  });
});
