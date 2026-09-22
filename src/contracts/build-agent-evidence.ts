import type { EngineMcpRun } from '../mcp-runner.js';
import {
  AGENT_EVIDENCE_SCHEMA_VERSION,
  AgentEvidenceV1Schema,
  type AgentEvidenceFindingV1,
  type AgentEvidenceSubjectV1,
  type AgentEvidenceV1,
} from './agent-evidence.js';

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function integer(value: unknown, fallback = 0): number {
  const parsed = numberValue(value);
  return parsed === null ? fallback : Math.max(0, Math.trunc(parsed));
}

function subject(value: unknown): AgentEvidenceSubjectV1 {
  const item = record(value);
  const identity =
    stringValue(item?.key) ??
    stringValue(item?.selector) ??
    stringValue(item?.identity) ??
    stringValue(item?.id) ??
    'unknown';

  const quality = item?.quality;

  return {
    identity,
    tagName: stringValue(item?.tagName),
    matchQuality: quality === 'explicit' || quality === 'structural' ? quality : null,
  };
}

function nullableSubject(value: unknown): AgentEvidenceSubjectV1 | null {
  return value === null || value === undefined ? null : subject(value);
}

function compareRange(finding: UnknownRecord): AgentEvidenceFindingV1['range'] {
  const exact = record(finding.exactRange);
  const sampled = record(finding.sampledRange);
  const exactMin = numberValue(exact?.minWidth);
  const exactMax = numberValue(exact?.maxWidth);
  const sampledMin = numberValue(sampled?.minWidth);
  const sampledMax = numberValue(sampled?.maxWidth);

  const kind =
    exactMin !== null && exactMax !== null
      ? 'exact'
      : exactMin !== null || exactMax !== null
        ? 'partial_exact'
        : sampledMin !== null || sampledMax !== null
          ? 'sampled'
          : 'unknown';

  return {
    kind,
    minWidth: exactMin,
    maxWidth: exactMax,
    sampledMinWidth: sampledMin,
    sampledMaxWidth: sampledMax,
    viewportWidth: null,
  };
}

function compareFinding(value: unknown): AgentEvidenceFindingV1 | null {
  const finding = record(value);
  if (!finding || finding.direction !== 'introduced') return null;

  const type = finding.type;
  if (
    type !== 'overlap' &&
    type !== 'protrusion' &&
    type !== 'reparenting' &&
    type !== 'disappearance' &&
    type !== 'appearance'
  ) {
    return null;
  }

  const baseline = record(finding.baseline);
  const candidate = record(finding.candidate);
  const related = Array.isArray(finding.relatedSubjects) ? finding.relatedSubjects : [];

  return {
    id: stringValue(finding.id) ?? `structural-${type}`,
    category: 'structural',
    type,
    direction: 'introduced',
    groupId: null,
    subject: subject(finding.subject),
    relatedSubjects: related.map(subject),
    range: compareRange(finding),
    baseline: {
      state: stringValue(baseline?.state),
      parent: nullableSubject(baseline?.parent),
    },
    candidate: {
      state: stringValue(candidate?.state),
      parent: nullableSubject(candidate?.parent),
    },
  };
}

function relatedScanSubjects(issue: UnknownRecord): AgentEvidenceSubjectV1[] {
  const related: AgentEvidenceSubjectV1[] = [];

  for (const [selectorField, tagField] of [
    ['otherSelector', 'otherTagName'],
    ['targetSelector', 'targetTagName'],
    ['parentSelector', 'parentTagName'],
  ] as const) {
    const identity = stringValue(issue[selectorField]);
    if (!identity) continue;

    related.push({
      identity,
      tagName: stringValue(issue[tagField]),
      matchQuality: null,
    });
  }

  return related;
}

function scanFinding(value: unknown, viewportWidth: number): AgentEvidenceFindingV1 | null {
  const issue = record(value);
  if (!issue) return null;

  const type = issue.type;
  if (
    type !== 'horizontal-overflow' &&
    type !== 'fixed-element-collision' &&
    type !== 'fixed-content-occlusion' &&
    type !== 'wrapping'
  ) {
    return null;
  }

  return {
    id: stringValue(issue.id) ?? `${type}-${viewportWidth}`,
    category: 'layout',
    type,
    direction: 'current',
    groupId: stringValue(issue.rootCauseId),
    subject: subject(issue),
    relatedSubjects: relatedScanSubjects(issue),
    range: {
      kind: 'viewport',
      minWidth: viewportWidth,
      maxWidth: viewportWidth,
      sampledMinWidth: viewportWidth,
      sampledMaxWidth: viewportWidth,
      viewportWidth,
    },
    baseline: {
      state: null,
      parent: null,
    },
    candidate: {
      state: 'present',
      parent: null,
    },
  };
}

function scanFindings(report: UnknownRecord | null): AgentEvidenceFindingV1[] {
  const viewports = Array.isArray(report?.viewports) ? report.viewports : [];
  const findings: AgentEvidenceFindingV1[] = [];

  for (const viewportValue of viewports) {
    const viewport = record(viewportValue);
    if (!viewport || viewport.status !== 'fail') continue;
    const width = numberValue(viewport.width);
    if (width === null) continue;
    const issues = Array.isArray(viewport.issues) ? viewport.issues : [];

    for (const issue of issues) {
      const finding = scanFinding(issue, width);
      if (finding) findings.push(finding);
    }
  }

  return findings;
}

function compareFindings(report: UnknownRecord | null): AgentEvidenceFindingV1[] {
  const findings = Array.isArray(report?.findings) ? report.findings : [];
  return findings
    .map(compareFinding)
    .filter((finding): finding is AgentEvidenceFindingV1 => finding !== null);
}

function summaryValue(report: UnknownRecord | null, key: string): unknown {
  return record(report?.summary)?.[key];
}

function canonicalExitCode(exitCode: number): 0 | 1 | 2 {
  if (exitCode === 0) return 0;
  if (exitCode === 1) return 1;
  return 2;
}

export function buildCanonicalAgentEvidenceV1(run: EngineMcpRun): AgentEvidenceV1 {
  const report = record(run.report);
  const findings = run.mode === 'compare' ? compareFindings(report) : scanFindings(report);
  const viewportsChecked = integer(summaryValue(report, 'viewportsChecked'));
  const resolvedCount =
    run.mode === 'compare' ? integer(summaryValue(report, 'resolvedRanges')) : 0;
  const durationMs = numberValue(summaryValue(report, 'durationMs'));
  const exitCode = canonicalExitCode(run.exitCode);

  return AgentEvidenceV1Schema.parse({
    schemaVersion: AGENT_EVIDENCE_SCHEMA_VERSION,
    mode: run.mode,
    outcome: exitCode === 0 ? 'clean' : exitCode === 1 ? 'findings' : 'infra_failure',
    exitCode,
    summary: {
      viewportsChecked,
      findingCount: findings.length,
      introducedCount: run.mode === 'compare' ? findings.length : 0,
      resolvedCount,
      durationMs: durationMs === null ? null : Math.max(0, Math.trunc(durationMs)),
    },
    findings,
    evidence: {
      reportPath: run.reportPath,
      format: run.mode === 'compare' ? 'structural-diff.v1' : 'results.v1',
    },
    error: exitCode === 2 ? stringValue(run.stderr) ?? 'engine execution failed' : null,
  });
}
