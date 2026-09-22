import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AgentEvidenceV5 } from './contracts/agent-evidence-v5.js';
import { buildCanonicalAgentEvidenceV5 } from './contracts/build-agent-evidence-v5.js';

export interface EngineMcpOptions {
  widths?: number[];
  height?: number;
  waitMs?: number;
  timeoutMs?: number;
  boundary?: boolean;
  readySelector?: string;
  config?: string;
  outBase?: string;
}

export interface EngineMcpRun {
  mode: 'scan' | 'compare';
  exitCode: number;
  outcome: 'clean' | 'findings' | 'infra_failure';
  reportPath: string;
  report: Record<string, unknown> | null;
  stderr: string;
}

function cliPath(): string {
  return fileURLToPath(new URL('./cli.mjs', import.meta.url));
}

function appendCommonArgs(args: string[], options: EngineMcpOptions): void {
  if (options.widths?.length) {
    args.push('--widths', options.widths.join(','));
  }
  if (options.height !== undefined) args.push('--height', String(options.height));
  if (options.waitMs !== undefined) args.push('--wait', String(options.waitMs));
  if (options.timeoutMs !== undefined) args.push('--timeout', String(options.timeoutMs));
  if (options.boundary === false) args.push('--no-boundary');
  if (options.readySelector) args.push('--ready-selector', options.readySelector);
  if (options.config) args.push('--config', options.config);
}

export function buildEngineArgs({
  candidateUrl,
  baselineUrl,
  outDir,
  options,
}: {
  candidateUrl: string;
  baselineUrl?: string;
  outDir: string;
  options: EngineMcpOptions;
}): string[] {
  const args = [cliPath(), candidateUrl, '--out', outDir];

  if (baselineUrl) args.push('--baseline-url', baselineUrl);
  appendCommonArgs(args, options);
  return args;
}

async function createOutDir(base: string, mode: 'scan' | 'compare'): Promise<string> {
  const absoluteBase = resolve(base);
  await mkdir(absoluteBase, { recursive: true });
  return mkdtemp(join(absoluteBase, `${mode}-`));
}

function outcome(exitCode: number): EngineMcpRun['outcome'] {
  if (exitCode === 0) return 'clean';
  if (exitCode === 1) return 'findings';
  return 'infra_failure';
}

export async function runEngineForMcp({
  candidateUrl,
  baselineUrl,
  options = {},
  spawnImpl = spawn,
}: {
  candidateUrl: string;
  baselineUrl?: string;
  options?: EngineMcpOptions;
  spawnImpl?: typeof spawn;
}): Promise<EngineMcpRun> {
  const mode = baselineUrl ? 'compare' : 'scan';
  const outDir = await createOutDir(options.outBase ?? '.slice/mcp', mode);
  const resultName = baselineUrl ? 'structural-diff.json' : 'results.json';
  const reportPath = join(outDir, resultName);
  const args = buildEngineArgs({ candidateUrl, baselineUrl, outDir, options });

  const child = spawnImpl(process.execPath, args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NO_COLOR: '1',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });

  let stderr = '';
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (chunk) => {
    stderr += chunk;
  });

  const exitCode = await new Promise<number>((resolveExit, reject) => {
    child.once('error', reject);
    child.once('close', (code) => resolveExit(code ?? 2));
  });

  let report: Record<string, unknown> | null = null;
  try {
    report = JSON.parse(await readFile(reportPath, 'utf8')) as Record<string, unknown>;
  } catch {
    report = null;
  }

  return {
    mode,
    exitCode,
    outcome: outcome(exitCode),
    reportPath,
    report,
    stderr: stderr.trim(),
  };
}

export function canonicalMcpResult(run: EngineMcpRun): AgentEvidenceV5 {
  return buildCanonicalAgentEvidenceV5(run);
}

export function mcpTextSummary(result: AgentEvidenceV5): string {
  const evidencePath = result.evidence.reportPath;

  if (result.mode === 'compare') {
    return (
      `Viewportable compare: ${result.outcome}; ${result.summary.findingCount} introduced finding(s); ` +
      `${result.summary.viewportsChecked} viewport(s); evidence: ${evidencePath}`
    );
  }

  return (
    `Viewportable scan: ${result.outcome}; ${result.summary.findingCount} current finding(s); ` +
    `${result.summary.viewportsChecked} viewport(s); evidence: ${evidencePath}`
  );
}
