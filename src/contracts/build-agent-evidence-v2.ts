import type { EngineMcpRun } from '../mcp-runner.js';
import { buildCanonicalAgentEvidenceV1 } from './build-agent-evidence.js';
import {
  AGENT_EVIDENCE_SCHEMA_VERSION_V2,
  AgentEvidenceV2Schema,
  type AgentEvidenceSourceV2,
  type AgentEvidenceV2,
} from './agent-evidence-v2.js';

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function source(value: unknown): AgentEvidenceSourceV2 | null {
  const item = record(value);
  if (!item) return null;

  const property = item.property;
  if (property !== 'min-width' && property !== 'width') return null;
  if (typeof item.selector !== 'string' || typeof item.value !== 'string') return null;

  return {
    kind: 'css-declaration',
    confidence: 'deterministic',
    stylesheet: typeof item.stylesheet === 'string' ? item.stylesheet : null,
    selector: item.selector,
    property,
    value: item.value,
    media: typeof item.media === 'string' ? item.media : null,
  };
}

function compareSources(report: UnknownRecord | null): Map<string, AgentEvidenceSourceV2 | null> {
  const result = new Map<string, AgentEvidenceSourceV2 | null>();
  const findings = Array.isArray(report?.findings) ? report.findings : [];

  for (const value of findings) {
    const finding = record(value);
    if (!finding || typeof finding.id !== 'string') continue;
    result.set(finding.id, source(finding.source));
  }

  return result;
}

function scanSources(report: UnknownRecord | null): Map<string, AgentEvidenceSourceV2 | null> {
  const byRoot = new Map<string, AgentEvidenceSourceV2 | null>();
  const roots = Array.isArray(report?.rootCauses) ? report.rootCauses : [];

  for (const value of roots) {
    const root = record(value);
    if (!root || typeof root.id !== 'string') continue;
    const diagnosis = record(root.diagnosis);
    byRoot.set(root.id, source(diagnosis?.source));
  }

  return byRoot;
}

export function buildCanonicalAgentEvidenceV2(run: EngineMcpRun): AgentEvidenceV2 {
  const v1 = buildCanonicalAgentEvidenceV1(run);
  const report = record(run.report);
  const sources = run.mode === 'compare' ? compareSources(report) : scanSources(report);

  return AgentEvidenceV2Schema.parse({
    ...v1,
    schemaVersion: AGENT_EVIDENCE_SCHEMA_VERSION_V2,
    findings: v1.findings.map((finding) => ({
      ...finding,
      source:
        sources.get(finding.id) ?? (finding.groupId ? sources.get(finding.groupId) : null) ?? null,
    })),
  });
}
