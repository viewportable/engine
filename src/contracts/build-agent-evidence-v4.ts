import type { EngineMcpRun } from '../mcp-runner.js';
import { buildCanonicalAgentEvidenceV3 } from './build-agent-evidence-v3.js';
import {
  AGENT_EVIDENCE_SCHEMA_VERSION_V4,
  AgentEvidenceV4Schema,
  type AgentEvidenceAuthoredLocationV4,
  type AgentEvidenceV4,
} from './agent-evidence-v4.js';

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function positiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

function authoredLocation(value: unknown): AgentEvidenceAuthoredLocationV4 | null {
  const item = record(value);
  if (!item) return null;

  if (
    item.kind !== 'source-map-property' ||
    item.confidence !== 'deterministic' ||
    item.coordinateSpace !== 'authored-source' ||
    typeof item.source !== 'string' ||
    item.source.length === 0 ||
    typeof item.resolvedSource !== 'string' ||
    item.resolvedSource.length === 0 ||
    typeof item.sourceContentSha256 !== 'string' ||
    !/^[0-9a-f]{64}$/.test(item.sourceContentSha256)
  ) {
    return null;
  }

  const start = record(item.start);
  const line = positiveInteger(start?.line);
  const column = positiveInteger(start?.column);
  if (line === null || column === null) return null;

  const sourceMap = record(item.sourceMap);
  if (
    sourceMap?.version !== 3 ||
    (sourceMap.kind !== 'inline' && sourceMap.kind !== 'external') ||
    (sourceMap.url !== null && typeof sourceMap.url !== 'string')
  ) {
    return null;
  }

  return {
    kind: 'source-map-property',
    confidence: 'deterministic',
    coordinateSpace: 'authored-source',
    source: item.source,
    resolvedSource: item.resolvedSource,
    start: { line, column },
    sourceContentSha256: item.sourceContentSha256,
    sourceMap: {
      version: 3,
      kind: sourceMap.kind,
      url: sourceMap.url,
    },
  };
}

function compareAuthoredLocations(
  report: UnknownRecord | null,
): Map<string, AgentEvidenceAuthoredLocationV4 | null> {
  const result = new Map<string, AgentEvidenceAuthoredLocationV4 | null>();
  const findings = Array.isArray(report?.findings) ? report.findings : [];

  for (const value of findings) {
    const finding = record(value);
    if (!finding || typeof finding.id !== 'string') continue;
    const source = record(finding.source);
    result.set(finding.id, authoredLocation(source?.authoredLocation));
  }

  return result;
}

export function buildCanonicalAgentEvidenceV4(run: EngineMcpRun): AgentEvidenceV4 {
  const v3 = buildCanonicalAgentEvidenceV3(run);
  const report = record(run.report);
  const authoredLocations =
    run.mode === 'compare' ? compareAuthoredLocations(report) : new Map();

  return AgentEvidenceV4Schema.parse({
    ...v3,
    schemaVersion: AGENT_EVIDENCE_SCHEMA_VERSION_V4,
    findings: v3.findings.map((finding) => ({
      ...finding,
      source:
        finding.source === null
          ? null
          : {
              ...finding.source,
              authoredLocation: authoredLocations.get(finding.id) ?? null,
            },
    })),
  });
}
