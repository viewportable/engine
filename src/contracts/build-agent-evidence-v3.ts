import type { EngineMcpRun } from '../mcp-runner.js';
import { buildCanonicalAgentEvidenceV2 } from './build-agent-evidence-v2.js';
import {
  AGENT_EVIDENCE_SCHEMA_VERSION_V3,
  AgentEvidenceV3Schema,
  type AgentEvidenceSourceLocationV3,
  type AgentEvidenceV3,
} from './agent-evidence-v3.js';

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function positiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

function location(value: unknown): AgentEvidenceSourceLocationV3 | null {
  const item = record(value);
  if (!item) return null;
  if (
    item.kind !== 'css-property-range' ||
    item.confidence !== 'deterministic' ||
    item.coordinateSpace !== 'stylesheet'
  ) {
    return null;
  }

  const start = record(item.start);
  const end = record(item.end);
  const startLine = positiveInteger(start?.line);
  const startColumn = positiveInteger(start?.column);
  const endLine = positiveInteger(end?.line);
  const endColumn = positiveInteger(end?.column);

  if (startLine === null || startColumn === null || endLine === null || endColumn === null) {
    return null;
  }

  return {
    kind: 'css-property-range',
    confidence: 'deterministic',
    coordinateSpace: 'stylesheet',
    start: {
      line: startLine,
      column: startColumn,
    },
    end: {
      line: endLine,
      column: endColumn,
    },
  };
}

function compareLocations(
  report: UnknownRecord | null,
): Map<string, AgentEvidenceSourceLocationV3 | null> {
  const result = new Map<string, AgentEvidenceSourceLocationV3 | null>();
  const findings = Array.isArray(report?.findings) ? report.findings : [];

  for (const value of findings) {
    const finding = record(value);
    if (!finding || typeof finding.id !== 'string') continue;
    const source = record(finding.source);
    result.set(finding.id, location(source?.location));
  }

  return result;
}

function scanLocations(
  report: UnknownRecord | null,
): Map<string, AgentEvidenceSourceLocationV3 | null> {
  const result = new Map<string, AgentEvidenceSourceLocationV3 | null>();
  const roots = Array.isArray(report?.rootCauses) ? report.rootCauses : [];

  for (const value of roots) {
    const root = record(value);
    if (!root || typeof root.id !== 'string') continue;
    const diagnosis = record(root.diagnosis);
    const source = record(diagnosis?.source);
    result.set(root.id, location(source?.location));
  }

  return result;
}

export function buildCanonicalAgentEvidenceV3(run: EngineMcpRun): AgentEvidenceV3 {
  const v2 = buildCanonicalAgentEvidenceV2(run);
  const report = record(run.report);
  const locations = run.mode === 'compare' ? compareLocations(report) : scanLocations(report);

  return AgentEvidenceV3Schema.parse({
    ...v2,
    schemaVersion: AGENT_EVIDENCE_SCHEMA_VERSION_V3,
    findings: v2.findings.map((finding) => ({
      ...finding,
      source:
        finding.source === null
          ? null
          : {
              ...finding.source,
              location:
                locations.get(finding.id) ??
                (finding.groupId ? locations.get(finding.groupId) : null) ??
                null,
            },
    })),
  });
}
