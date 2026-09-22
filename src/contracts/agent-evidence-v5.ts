import * as z from 'zod/v4';
import { AgentEvidenceSummaryV1Schema } from './agent-evidence.js';
import { AgentEvidenceFindingV4Schema } from './agent-evidence-v4.js';

export const AGENT_EVIDENCE_SCHEMA_VERSION_V5 = 'viewportable.agent-evidence.v5' as const;

export const AgentEvidenceRepairV5Schema = z.discriminatedUnion('repairable', [
  z
    .object({
      repairable: z.literal(true),
      reason: z.literal('deterministic-authored-css'),
    })
    .strict(),
  z
    .object({
      repairable: z.literal(false),
      reason: z.enum([
        'unsupported-finding',
        'missing-deterministic-source',
        'missing-stylesheet-location',
        'missing-authored-location',
      ]),
    })
    .strict(),
]);

export const AgentEvidenceFindingV5Schema = AgentEvidenceFindingV4Schema.extend({
  repair: AgentEvidenceRepairV5Schema,
}).strict();

export const AgentEvidenceV5Schema = z
  .object({
    schemaVersion: z.literal(AGENT_EVIDENCE_SCHEMA_VERSION_V5),
    mode: z.enum(['scan', 'compare']),
    outcome: z.enum(['clean', 'findings', 'infra_failure']),
    exitCode: z.union([z.literal(0), z.literal(1), z.literal(2)]),
    summary: AgentEvidenceSummaryV1Schema,
    findings: z.array(AgentEvidenceFindingV5Schema),
    evidence: z
      .object({
        reportPath: z.string().min(1),
        format: z.enum(['results.v1', 'structural-diff.v1']),
      })
      .strict(),
    error: z.string().min(1).nullable(),
  })
  .strict();

export type AgentEvidenceV5 = z.infer<typeof AgentEvidenceV5Schema>;
export type AgentEvidenceFindingV5 = z.infer<typeof AgentEvidenceFindingV5Schema>;
export type AgentEvidenceRepairV5 = z.infer<typeof AgentEvidenceRepairV5Schema>;

export function agentEvidenceV5JsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(AgentEvidenceV5Schema) as Record<string, unknown>;
}
