import * as z from 'zod/v4';

export const AGENT_EVIDENCE_SCHEMA_VERSION = 'viewportable.agent-evidence.v1' as const;

export const AgentEvidenceSubjectV1Schema = z
  .object({
    identity: z.string().min(1),
    tagName: z.string().min(1).nullable(),
    matchQuality: z.enum(['explicit', 'structural']).nullable(),
  })
  .strict();

export const AgentEvidenceStateV1Schema = z
  .object({
    state: z.string().min(1).nullable(),
    parent: AgentEvidenceSubjectV1Schema.nullable(),
  })
  .strict();

export const AgentEvidenceRangeV1Schema = z
  .object({
    kind: z.enum(['exact', 'partial_exact', 'sampled', 'viewport', 'unknown']),
    minWidth: z.number().int().positive().nullable(),
    maxWidth: z.number().int().positive().nullable(),
    sampledMinWidth: z.number().int().positive().nullable(),
    sampledMaxWidth: z.number().int().positive().nullable(),
    viewportWidth: z.number().int().positive().nullable(),
  })
  .strict();

export const AgentEvidenceFindingV1Schema = z
  .object({
    id: z.string().min(1),
    category: z.enum(['layout', 'structural']),
    type: z.enum([
      'horizontal-overflow',
      'fixed-element-collision',
      'fixed-content-occlusion',
      'wrapping',
      'overlap',
      'protrusion',
      'reparenting',
      'disappearance',
      'appearance',
    ]),
    direction: z.enum(['current', 'introduced', 'resolved']),
    groupId: z.string().min(1).nullable(),
    subject: AgentEvidenceSubjectV1Schema,
    relatedSubjects: z.array(AgentEvidenceSubjectV1Schema),
    range: AgentEvidenceRangeV1Schema,
    baseline: AgentEvidenceStateV1Schema,
    candidate: AgentEvidenceStateV1Schema,
  })
  .strict();

export const AgentEvidenceSummaryV1Schema = z
  .object({
    viewportsChecked: z.number().int().nonnegative(),
    findingCount: z.number().int().nonnegative(),
    introducedCount: z.number().int().nonnegative(),
    resolvedCount: z.number().int().nonnegative(),
    durationMs: z.number().int().nonnegative().nullable(),
  })
  .strict();

export const AgentEvidenceV1Schema = z
  .object({
    schemaVersion: z.literal(AGENT_EVIDENCE_SCHEMA_VERSION),
    mode: z.enum(['scan', 'compare']),
    outcome: z.enum(['clean', 'findings', 'infra_failure']),
    exitCode: z.union([z.literal(0), z.literal(1), z.literal(2)]),
    summary: AgentEvidenceSummaryV1Schema,
    findings: z.array(AgentEvidenceFindingV1Schema),
    evidence: z
      .object({
        reportPath: z.string().min(1),
        format: z.enum(['results.v1', 'structural-diff.v1']),
      })
      .strict(),
    error: z.string().min(1).nullable(),
  })
  .strict();

export type AgentEvidenceV1 = z.infer<typeof AgentEvidenceV1Schema>;
export type AgentEvidenceFindingV1 = z.infer<typeof AgentEvidenceFindingV1Schema>;
export type AgentEvidenceSubjectV1 = z.infer<typeof AgentEvidenceSubjectV1Schema>;

export function agentEvidenceV1JsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(AgentEvidenceV1Schema) as Record<string, unknown>;
}
