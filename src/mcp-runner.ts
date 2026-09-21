import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
    stdio: ['ignore', 'pipe', 'pipe'],
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

export function compactMcpResult(run: EngineMcpRun): Record<string, unknown> {
  const summary =
    run.report && typeof run.report.summary === 'object' && run.report.summary !== null
      ? run.report.summary
      : null;

  if (run.mode === 'compare') {
    const findings =
      run.report && Array.isArray(run.report.findings)
        ? run.report.findings.filter(
            (finding) =>
              typeof finding === 'object' &&
              finding !== null &&
              'direction' in finding &&
              finding.direction === 'introduced',
          )
        : [];

    return {
      mode: run.mode,
      outcome: run.outcome,
      exitCode: run.exitCode,
      reportPath: run.reportPath,
      summary,
      findings,
      ...(run.stderr ? { stderr: run.stderr } : {}),
    };
  }

  const rootCauses =
    run.report && Array.isArray(run.report.rootCauses) ? run.report.rootCauses : [];
  const failingViewports =
    run.report && Array.isArray(run.report.viewports)
      ? run.report.viewports.filter(
          (viewport) =>
            typeof viewport === 'object' &&
            viewport !== null &&
            'status' in viewport &&
            viewport.status === 'fail',
        )
      : [];

  return {
    mode: run.mode,
    outcome: run.outcome,
    exitCode: run.exitCode,
    reportPath: run.reportPath,
    summary,
    rootCauses,
    failingViewports,
    ...(run.stderr ? { stderr: run.stderr } : {}),
  };
}

export function mcpTextSummary(result: Record<string, unknown>): string {
  const outcome = String(result.outcome ?? 'unknown');
  const reportPath = String(result.reportPath ?? '');
  const summary =
    result.summary && typeof result.summary === 'object'
      ? JSON.stringify(result.summary)
      : 'no summary';

  if (result.mode === 'compare') {
    const findings = Array.isArray(result.findings) ? result.findings.length : 0;
    return `Viewportable compare: ${outcome}; ${findings} introduced finding(s); ${summary}; evidence: ${reportPath}`;
  }

  const failing = Array.isArray(result.failingViewports) ? result.failingViewports.length : 0;
  return `Viewportable scan: ${outcome}; ${failing} failing viewport(s); ${summary}; evidence: ${reportPath}`;
}
