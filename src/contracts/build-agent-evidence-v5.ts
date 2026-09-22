import type { EngineMcpRun } from '../mcp-runner.js';
import type { AgentEvidenceFindingV4 } from './agent-evidence-v4.js';
import {
  AGENT_EVIDENCE_SCHEMA_VERSION_V5,
  AgentEvidenceV5Schema,
  type AgentEvidenceRepairV5,
  type AgentEvidenceV5,
} from './agent-evidence-v5.js';
import { buildCanonicalAgentEvidenceV4 } from './build-agent-evidence-v4.js';

function repairPolicy(finding: AgentEvidenceFindingV4): AgentEvidenceRepairV5 {
  const supportedFinding =
    (finding.type === 'protrusion' && finding.direction === 'introduced') ||
    (finding.type === 'horizontal-overflow' && finding.direction === 'current');

  if (!supportedFinding) {
    return {
      repairable: false,
      reason: 'unsupported-finding',
    };
  }

  if (finding.source === null) {
    return {
      repairable: false,
      reason: 'missing-deterministic-source',
    };
  }

  if (finding.source.location === null) {
    return {
      repairable: false,
      reason: 'missing-stylesheet-location',
    };
  }

  if (finding.source.authoredLocation === null) {
    return {
      repairable: false,
      reason: 'missing-authored-location',
    };
  }

  return {
    repairable: true,
    reason: 'deterministic-authored-css',
  };
}

export function buildCanonicalAgentEvidenceV5(run: EngineMcpRun): AgentEvidenceV5 {
  const v4 = buildCanonicalAgentEvidenceV4(run);

  return AgentEvidenceV5Schema.parse({
    ...v4,
    schemaVersion: AGENT_EVIDENCE_SCHEMA_VERSION_V5,
    findings: v4.findings.map((finding) => ({
      ...finding,
      repair: repairPolicy(finding),
    })),
  });
}
