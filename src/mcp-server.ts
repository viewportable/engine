import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { AgentEvidenceV5Schema } from './contracts/agent-evidence-v5.js';
import { ProjectAgentEvidenceV1Schema } from './contracts/project-agent-evidence-v1.js';
import type { CanonicalMcpResult } from './mcp-runner.js';
import { canonicalMcpResult, mcpTextSummary, runEngineForMcp } from './mcp-runner.js';

const widthsSchema = z
  .array(z.number().int().positive())
  .min(1)
  .optional()
  .describe('Viewport widths in CSS pixels');

const commonShape = {
  widths: widthsSchema,
  height: z.number().int().positive().optional().describe('Viewport height in CSS pixels'),
  waitMs: z.number().int().nonnegative().optional().describe('Delay after each resize'),
  timeoutMs: z.number().int().positive().optional().describe('Page load/readiness timeout'),
  boundary: z
    .boolean()
    .optional()
    .describe('Refine introduced findings to exact pixel boundaries; defaults to true'),
  readySelector: z
    .string()
    .min(1)
    .optional()
    .describe('Require this selector to become visible before scanning'),
  config: z.string().min(1).optional().describe('Path to slice.config.json'),
  outBase: z
    .string()
    .min(1)
    .optional()
    .describe('Directory under which MCP evidence directories are retained'),
  changedFiles: z
    .array(z.string().min(1))
    .min(1)
    .optional()
    .describe('Repo-relative changed files used for conservative project route selection'),
};

const outputSchema = z.union([AgentEvidenceV5Schema, ProjectAgentEvidenceV1Schema]);

function toolResult(result: CanonicalMcpResult) {
  return {
    content: [{ type: 'text' as const, text: mcpTextSummary(result) }],
    structuredContent: result,
    isError: result.outcome === 'infra_failure',
  };
}

export function createViewportableMcpServer({
  run = runEngineForMcp,
}: {
  run?: typeof runEngineForMcp;
} = {}): McpServer {
  const server = new McpServer(
    {
      name: 'viewportable-engine',
      version: '0.1.0',
    },
    {
      instructions:
        'Use viewportable_scan for one rendered application state or an explicit project route set from slice.config.json, and viewportable_compare to compare baseline and candidate versions. Treat exitCode 1 as product evidence, not a tool failure; exitCode 2 is scanner/setup failure. Per-route finding.repair remains the canonical auto-repair eligibility decision; do not infer repairability from source fields independently.',
    },
  );

  server.registerTool(
    'viewportable_scan',
    {
      title: 'Scan responsive UI',
      description:
        'Run deterministic Viewportable Engine responsive QA against one URL or the explicit routes configured in slice.config.json, returning canonical evidence plus retained report paths.',
      inputSchema: z.object({
        url: z.string().url().describe('Application URL to inspect'),
        ...commonShape,
      }),
      outputSchema,
      annotations: {
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ url, ...options }) => {
      const execution = await run({
        candidateUrl: url,
        options,
      });
      return toolResult(canonicalMcpResult(execution));
    },
  );

  server.registerTool(
    'viewportable_compare',
    {
      title: 'Compare responsive UI',
      description:
        'Run the same deterministic structural comparison used by the CLI and GitHub Action against baseline and candidate URLs. Returns introduced canonical findings and retains the full structural report.',
      inputSchema: z.object({
        baselineUrl: z.string().url().describe('Reference application URL'),
        candidateUrl: z.string().url().describe('Candidate application URL'),
        ...commonShape,
      }),
      outputSchema,
      annotations: {
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ baselineUrl, candidateUrl, ...options }) => {
      const execution = await run({
        baselineUrl,
        candidateUrl,
        options,
      });
      return toolResult(canonicalMcpResult(execution));
    },
  );

  return server;
}
