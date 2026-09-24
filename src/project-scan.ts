import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  PROJECT_AGENT_EVIDENCE_SCHEMA_VERSION_V1,
  ProjectAgentEvidenceV1Schema,
  type ProjectAgentEvidenceV1,
} from './contracts/project-agent-evidence-v1.js';
import { AgentEvidenceV5Schema, type AgentEvidenceV5 } from './contracts/agent-evidence-v5.js';
import { writeCanonicalAgentEvidenceV5 } from './contracts/write-agent-evidence-v5.js';
import type { ProjectScopePlan, ProjectScopeReason } from './changed-scope.js';
import type { RouteDiscoveryResult } from './route-discovery.js';

export const PROJECT_RESULTS_FILENAME = 'project-results.json';
export const PROJECT_AGENT_EVIDENCE_FILENAME = 'agent-evidence.json';

export interface ProjectScanRouteResult {
  route: string;
  url: string;
  status: 'pass' | 'fail' | 'infra_failure';
  exitCode: 0 | 1 | 2;
  reportPath: string | null;
  agentEvidencePath: string;
  summary: {
    viewportsChecked: number;
    findingCount: number;
    durationMs: number | null;
  };
  error: string | null;
  selectionReasons: ProjectScopeReason[];
}

export interface ProjectScanResults {
  version: 1;
  mode: 'project-scan';
  baseUrl: string;
  timestamp: string;
  discovery: RouteDiscoveryResult;
  scope: ProjectScopePlan;
  summary: {
    routesChecked: number;
    cleanRoutes: number;
    findingRoutes: number;
    infraFailureRoutes: number;
    viewportsChecked: number;
    findingCount: number;
    durationMs: number;
  };
  routes: ProjectScanRouteResult[];
}

export interface ProjectScanExecution {
  exitCode: 0 | 1 | 2;
  reportPath: string;
  agentEvidencePath: string;
  report: ProjectScanResults;
  agentEvidence: ProjectAgentEvidenceV1;
}

type ProjectRouteRunner = (url: string, outDir: string) => Promise<number>;

function routeArtifactSlug(route: string, index: number): string {
  const parsed = new URL(route, 'http://viewportable.invalid');
  const raw = `${parsed.pathname === '/' ? 'root' : parsed.pathname.slice(1)}${parsed.search}`;
  const slug =
    raw
      .replace(/[^A-Za-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'root';

  return `${String(index + 1).padStart(3, '0')}-${slug}`;
}

export function resolveProjectRoute(baseUrl: string, route: string): string {
  const base = new URL(baseUrl);
  const resolved = new URL(route, base);

  if (resolved.origin !== base.origin) {
    throw new Error(`Project route must stay on the base URL origin: ${route}`);
  }

  return resolved.href;
}

function exitCodeFor(outcomes: AgentEvidenceV5[]): 0 | 1 | 2 {
  if (outcomes.some((evidence) => evidence.exitCode === 2)) return 2;
  if (outcomes.some((evidence) => evidence.exitCode === 1)) return 1;
  return 0;
}

function projectOutcome(exitCode: 0 | 1 | 2): ProjectAgentEvidenceV1['outcome'] {
  if (exitCode === 0) return 'clean';
  if (exitCode === 1) return 'findings';
  return 'infra_failure';
}

function routeStatus(evidence: AgentEvidenceV5): ProjectScanRouteResult['status'] {
  if (evidence.outcome === 'clean') return 'pass';
  if (evidence.outcome === 'findings') return 'fail';
  return 'infra_failure';
}

async function readRouteEvidence(outDir: string): Promise<AgentEvidenceV5> {
  const content = await readFile(path.join(outDir, PROJECT_AGENT_EVIDENCE_FILENAME), 'utf8');
  return AgentEvidenceV5Schema.parse(JSON.parse(content));
}

export async function runProjectScan({
  baseUrl,
  discovery,
  scope,
  outDir,
  runRoute,
}: {
  baseUrl: string;
  discovery: RouteDiscoveryResult;
  scope: ProjectScopePlan;
  outDir: string;
  runRoute: ProjectRouteRunner;
}): Promise<ProjectScanExecution> {
  const startedAt = Date.now();
  const projectOut = outDir;
  const routesOut = path.join(projectOut, 'routes');
  await mkdir(routesOut, { recursive: true });

  const routeResults: ProjectScanRouteResult[] = [];
  const routeEvidence: Array<{ route: string; url: string; evidence: AgentEvidenceV5 }> = [];

  for (const [index, selection] of scope.selections.entries()) {
    const route = selection.route;
    const url = resolveProjectRoute(baseUrl, route);
    const routeOut = path.join(routesOut, routeArtifactSlug(route, index));
    await mkdir(routeOut, { recursive: true });

    let evidence: AgentEvidenceV5;

    try {
      await runRoute(url, routeOut);
      evidence = await readRouteEvidence(routeOut);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const reportPath = path.join(routeOut, 'results.json');

      await writeCanonicalAgentEvidenceV5(routeOut, {
        mode: 'scan',
        exitCode: 2,
        outcome: 'infra_failure',
        reportPath,
        report: null,
        stderr: message,
      });

      evidence = await readRouteEvidence(routeOut);
    }

    const reportPath = evidence.outcome === 'infra_failure' ? null : evidence.evidence.reportPath;
    const agentEvidencePath = path.join(routeOut, PROJECT_AGENT_EVIDENCE_FILENAME);

    routeEvidence.push({ route, url, evidence });
    routeResults.push({
      route,
      url,
      status: routeStatus(evidence),
      exitCode: evidence.exitCode,
      reportPath,
      agentEvidencePath,
      summary: {
        viewportsChecked: evidence.summary.viewportsChecked,
        findingCount: evidence.summary.findingCount,
        durationMs: evidence.summary.durationMs,
      },
      error: evidence.error,
      selectionReasons: selection.reasons,
    });
  }

  const evidenceItems = routeEvidence.map((entry) => entry.evidence);
  const exitCode = exitCodeFor(evidenceItems);
  const durationMs = Date.now() - startedAt;
  const summary = {
    routesChecked: routeResults.length,
    cleanRoutes: routeResults.filter((route) => route.status === 'pass').length,
    findingRoutes: routeResults.filter((route) => route.status === 'fail').length,
    infraFailureRoutes: routeResults.filter((route) => route.status === 'infra_failure').length,
    viewportsChecked: routeResults.reduce((sum, route) => sum + route.summary.viewportsChecked, 0),
    findingCount: routeResults.reduce((sum, route) => sum + route.summary.findingCount, 0),
    durationMs,
  };

  const reportPath = path.join(projectOut, PROJECT_RESULTS_FILENAME);
  const agentEvidencePath = path.join(projectOut, PROJECT_AGENT_EVIDENCE_FILENAME);

  const report: ProjectScanResults = {
    version: 1,
    mode: 'project-scan',
    baseUrl,
    timestamp: new Date().toISOString(),
    discovery,
    scope,
    summary,
    routes: routeResults,
  };

  const agentEvidence = ProjectAgentEvidenceV1Schema.parse({
    schemaVersion: PROJECT_AGENT_EVIDENCE_SCHEMA_VERSION_V1,
    mode: 'project-scan',
    outcome: projectOutcome(exitCode),
    exitCode,
    summary,
    routes: routeEvidence,
    evidence: {
      reportPath,
      format: 'project-results.v1',
    },
    error:
      summary.infraFailureRoutes > 0
        ? `${summary.infraFailureRoutes} route(s) failed due to scanner/setup errors`
        : null,
  });

  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await writeFile(agentEvidencePath, `${JSON.stringify(agentEvidence, null, 2)}\n`, 'utf8');

  return {
    exitCode,
    reportPath,
    agentEvidencePath,
    report,
    agentEvidence,
  };
}
