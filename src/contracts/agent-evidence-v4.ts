import * as z from 'zod/v4';
import { AgentEvidenceSummaryV1Schema } from './agent-evidence.js';
import { AgentEvidenceSourceV3Schema } from './agent-evidence-v3.js';
import { AgentEvidenceFindingV1Schema } from './agent-evidence.js';

export const AGENT_EVIDENCE_SCHEMA_VERSION_V4 = 'viewportable.agent-evidence.v4' as const;

export const AgentEvidenceAuthoredLocationV4Schema = z
  .object({
    kind: z.literal('source-map-property'),
    confidence: z.literal('deterministic'),
    coordinateSpace: z.literal('authored-source'),
    source: z.string().min(1),
    resolvedSource: z.string().min(1),
    start: z
      .object({
        line: z.number().int().positive(),
        column: z.number().int().positive(),
      })
      .strict(),
    sourceContentSha256: z.string().regex(/^[0-9a-f]{64}$/),
    sourceMap: z
      .object({
        version: z.literal(3),
        kind: z.enum(['inline', 'external']),
        url: z.string().url().nullable(),
      })
      .strict(),
  })
  .strict();

export const AgentEvidenceSourceV4Schema = AgentEvidenceSourceV3Schema.extend({
  authoredLocation: AgentEvidenceAuthoredLocationV4Schema.nullable(),
}).strict();

export const AgentEvidenceFindingV4Schema = AgentEvidenceFindingV1Schema.extend({
  source: AgentEvidenceSourceV4Schema.nullable(),
}).strict();

export const AgentEvidenceV4Schema = z
  .object({
    schemaVersion: z.literal(AGENT_EVIDENCE_SCHEMA_VERSION_V4),
    mode: z.enum(['scan', 'compare']),
    outcome: z.enum(['clean', 'findings', 'infra_failure']),
    exitCode: z.union([z.literal(0), z.literal(1), z.literal(2)]),
    summary: AgentEvidenceSummaryV1Schema,
    findings: z.array(AgentEvidenceFindingV4Schema),
    evidence: z
      .object({
        reportPath: z.string().min(1),
        format: z.enum(['results.v1', 'structural-diff.v1']),
      })
      .strict(),
    error: z.string().min(1).nullable(),
  })
  .strict();

export type AgentEvidenceV4 = z.infer<typeof AgentEvidenceV4Schema>;
export type AgentEvidenceFindingV4 = z.infer<typeof AgentEvidenceFindingV4Schema>;
export type AgentEvidenceSourceV4 = z.infer<typeof AgentEvidenceSourceV4Schema>;
export type AgentEvidenceAuthoredLocationV4 = z.infer<typeof AgentEvidenceAuthoredLocationV4Schema>;

export function agentEvidenceV4JsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(AgentEvidenceV4Schema) as Record<string, unknown>;
}
