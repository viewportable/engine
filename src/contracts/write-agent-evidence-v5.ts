import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { EngineMcpRun } from '../mcp-runner.js';
import { buildCanonicalAgentEvidenceV5 } from './build-agent-evidence-v5.js';

export const AGENT_EVIDENCE_FILENAME = 'agent-evidence.json' as const;

export async function writeCanonicalAgentEvidenceV5(
  outDir: string,
  run: EngineMcpRun,
): Promise<string> {
  const evidence = buildCanonicalAgentEvidenceV5(run);
  await mkdir(outDir, { recursive: true });

  const outputPath = path.join(outDir, AGENT_EVIDENCE_FILENAME);
  await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');

  return outputPath;
}
