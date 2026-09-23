import * as z from 'zod/v4';
import { AgentEvidenceV5Schema } from './agent-evidence-v5.js';

export const PROJECT_AGENT_EVIDENCE_SCHEMA_VERSION_V1 =
  'viewportable.project-agent-evidence.v1' as const;

export const ProjectAgentEvidenceV1Schema = z
  .object({
    schemaVersion: z.literal(PROJECT_AGENT_EVIDENCE_SCHEMA_VERSION_V1),
    mode: z.literal('project-scan'),
    outcome: z.enum(['clean', 'findings', 'infra_failure']),
    exitCode: z.union([z.literal(0), z.literal(1), z.literal(2)]),
    summary: z
      .object({
        routesChecked: z.number().int().nonnegative(),
        cleanRoutes: z.number().int().nonnegative(),
        findingRoutes: z.number().int().nonnegative(),
        infraFailureRoutes: z.number().int().nonnegative(),
        viewportsChecked: z.number().int().nonnegative(),
        findingCount: z.number().int().nonnegative(),
        durationMs: z.number().nonnegative(),
      })
      .strict(),
    routes: z.array(
      z
        .object({
          route: z.string().min(1),
          url: z.string().url(),
          evidence: AgentEvidenceV5Schema,
        })
        .strict(),
    ),
    evidence: z
      .object({
        reportPath: z.string().min(1),
        format: z.literal('project-results.v1'),
      })
      .strict(),
    error: z.string().min(1).nullable(),
  })
  .strict();

export type ProjectAgentEvidenceV1 = z.infer<typeof ProjectAgentEvidenceV1Schema>;

export function projectAgentEvidenceV1JsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(ProjectAgentEvidenceV1Schema) as Record<string, unknown>;
}
