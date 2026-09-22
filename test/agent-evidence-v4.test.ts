import { describe, expect, it } from 'vitest';
import {
  AGENT_EVIDENCE_SCHEMA_VERSION_V4,
  AgentEvidenceV4Schema,
  agentEvidenceV4JsonSchema,
} from '../src/contracts/agent-evidence-v4.js';
import { buildCanonicalAgentEvidenceV4 } from '../src/contracts/build-agent-evidence-v4.js';
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
            key: 'id:proof',
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
          baseline: { state: 'contained' },
          candidate: { state: 'protruding' },
          source: {
            stylesheet: 'https://example.test/assets/app.css',
            selector: '.proof',
            property: 'min-width',
            value: '400px',
            media: null,
            location: {
              kind: 'css-property-range',
              confidence: 'deterministic',
              coordinateSpace: 'stylesheet',
              start: { line: 2, column: 3 },
              end: { line: 2, column: 20 },
            },
            authoredLocation: {
              kind: 'source-map-property',
              confidence: 'deterministic',
              coordinateSpace: 'authored-source',
              source: '../src/proof.scss',
              resolvedSource: 'https://example.test/src/proof.scss',
              start: { line: 4, column: 3 },
              sourceContentSha256:
                'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
              sourceMap: {
                version: 3,
                kind: 'external',
                url: 'https://example.test/assets/app.css.map',
              },
            },
          },
        },
      ],
    },
  };
}

describe('Viewportable Canonical Agent Evidence Contract V4', () => {
  it('adds a deterministic authored source-map location while preserving V3 location', () => {
    const result = buildCanonicalAgentEvidenceV4(compareRun());

    expect(result).toMatchObject({
      schemaVersion: AGENT_EVIDENCE_SCHEMA_VERSION_V4,
      findings: [
        {
          type: 'protrusion',
          source: {
            location: {
              coordinateSpace: 'stylesheet',
              start: { line: 2, column: 3 },
            },
            authoredLocation: {
              kind: 'source-map-property',
              confidence: 'deterministic',
              coordinateSpace: 'authored-source',
              source: '../src/proof.scss',
              resolvedSource: 'https://example.test/src/proof.scss',
              start: { line: 4, column: 3 },
              sourceMap: {
                version: 3,
                kind: 'external',
                url: 'https://example.test/assets/app.css.map',
              },
            },
          },
        },
      ],
    });
  });

  it('keeps authoredLocation null when mapping is unavailable', () => {
    const run = compareRun();
    const report = run.report as { findings: Array<Record<string, unknown>> };
    const source = report.findings[0]?.source as Record<string, unknown>;
    source.authoredLocation = null;

    expect(buildCanonicalAgentEvidenceV4(run).findings[0]?.source?.authoredLocation).toBeNull();
  });

  it('keeps V4 strict at authored source boundaries', () => {
    const valid = buildCanonicalAgentEvidenceV4(compareRun());
    const finding = valid.findings[0];

    expect(
      AgentEvidenceV4Schema.safeParse({
        ...valid,
        findings: [
          {
            ...finding,
            source: {
              ...finding?.source,
              authoredLocation: {
                ...finding?.source?.authoredLocation,
                guessedPath: 'src/proof.scss',
              },
            },
          },
        ],
      }).success,
    ).toBe(false);
  });

  it('exports strict V4 JSON Schema', () => {
    expect(agentEvidenceV4JsonSchema()).toMatchObject({
      type: 'object',
      additionalProperties: false,
      properties: {
        schemaVersion: {
          const: AGENT_EVIDENCE_SCHEMA_VERSION_V4,
        },
      },
    });
  });
});
