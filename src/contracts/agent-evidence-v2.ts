import * as z from 'zod/v4';
import {
  AgentEvidenceFindingV1Schema,
  AgentEvidenceStateV1Schema,
  AgentEvidenceSubjectV1Schema,
  AgentEvidenceRangeV1Schema,
  AgentEvidenceSummaryV1Schema,
} from './agent-evidence.js';

export const AGENT_EVIDENCE_SCHEMA_VERSION_V2 = 'viewportable.agent-evidence.v2' as const;

export const AgentEvidenceSourceV2Schema = z
  .object({
    kind: z.literal('css-declaration'),
    confidence: z.literal('deterministic'),
    stylesheet: z.string().nullable(),
    selector: z.string().min(1),
    property: z.enum(['min-width', 'width']),
    value: z.string().min(1),
    media: z.string().min(1).nullable(),
  })
  .strict();

export const AgentEvidenceFindingV2Schema = AgentEvidenceFindingV1Schema.extend({
  source: AgentEvidenceSourceV2Schema.nullable(),
}).strict();

export const AgentEvidenceV2Schema = z
  .object({
    schemaVersion: z.literal(AGENT_EVIDENCE_SCHEMA_VERSION_V2),
    mode: z.enum(['scan', 'compare']),
    outcome: z.enum(['clean', 'findings', 'infra_failure']),
    exitCode: z.union([z.literal(0), z.literal(1), z.literal(2)]),
    summary: AgentEvidenceSummaryV1Schema,
    findings: z.array(AgentEvidenceFindingV2Schema),
    evidence: z
      .object({
        reportPath: z.string().min(1),
        format: z.enum(['results.v1', 'structural-diff.v1']),
      })
      .strict(),
    error: z.string().min(1).nullable(),
  })
  .strict();

export type AgentEvidenceV2 = z.infer<typeof AgentEvidenceV2Schema>;
export type AgentEvidenceFindingV2 = z.infer<typeof AgentEvidenceFindingV2Schema>;
export type AgentEvidenceSourceV2 = z.infer<typeof AgentEvidenceSourceV2Schema>;

export function agentEvidenceV2JsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(AgentEvidenceV2Schema) as Record<string, unknown>;
}

// Re-export stable nested V1 primitives for consumers that share subject/range/state semantics.
export {
  AgentEvidenceRangeV1Schema,
  AgentEvidenceStateV1Schema,
  AgentEvidenceSubjectV1Schema,
};
