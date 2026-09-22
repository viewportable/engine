import * as z from 'zod/v4';
import {
  AgentEvidenceFindingV1Schema,
  AgentEvidenceSummaryV1Schema,
} from './agent-evidence.js';
import { AgentEvidenceSourceV2Schema } from './agent-evidence-v2.js';

export const AGENT_EVIDENCE_SCHEMA_VERSION_V3 = 'viewportable.agent-evidence.v3' as const;

export const AgentEvidenceSourceLocationV3Schema = z
  .object({
    kind: z.literal('css-property-range'),
    confidence: z.literal('deterministic'),
    coordinateSpace: z.literal('stylesheet'),
    start: z
      .object({
        line: z.number().int().positive(),
        column: z.number().int().positive(),
      })
      .strict(),
    end: z
      .object({
        line: z.number().int().positive(),
        column: z.number().int().positive(),
      })
      .strict(),
  })
  .strict();

export const AgentEvidenceSourceV3Schema = AgentEvidenceSourceV2Schema.extend({
  location: AgentEvidenceSourceLocationV3Schema.nullable(),
}).strict();

export const AgentEvidenceFindingV3Schema = AgentEvidenceFindingV1Schema.extend({
  source: AgentEvidenceSourceV3Schema.nullable(),
}).strict();

export const AgentEvidenceV3Schema = z
  .object({
    schemaVersion: z.literal(AGENT_EVIDENCE_SCHEMA_VERSION_V3),
    mode: z.enum(['scan', 'compare']),
    outcome: z.enum(['clean', 'findings', 'infra_failure']),
    exitCode: z.union([z.literal(0), z.literal(1), z.literal(2)]),
    summary: AgentEvidenceSummaryV1Schema,
    findings: z.array(AgentEvidenceFindingV3Schema),
    evidence: z
      .object({
        reportPath: z.string().min(1),
        format: z.enum(['results.v1', 'structural-diff.v1']),
      })
      .strict(),
    error: z.string().min(1).nullable(),
  })
  .strict();

export type AgentEvidenceV3 = z.infer<typeof AgentEvidenceV3Schema>;
export type AgentEvidenceSourceV3 = z.infer<typeof AgentEvidenceSourceV3Schema>;
export type AgentEvidenceSourceLocationV3 = z.infer<typeof AgentEvidenceSourceLocationV3Schema>;

export function agentEvidenceV3JsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(AgentEvidenceV3Schema) as Record<string, unknown>;
}
