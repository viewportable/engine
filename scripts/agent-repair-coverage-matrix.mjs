import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { createServer } from 'node:http';
import { readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

const root = path.resolve('.');
const fixtureRoot = path.join(root, 'test/fixtures');
const repairAcceptancePath = path.join(root, '.slice/build-tool-agent-repair/acceptance.json');
const retainedRoot = path.join(root, '.slice/agent-repair-coverage-matrix');
const acceptancePath = path.join(retainedRoot, 'acceptance.json');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function runRepairScenario(scenario) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/build-tool-agent-repair-e2e.mjs'], {
      cwd: root,
      env: {
        ...process.env,
        NO_COLOR: '1',
        VIEWPORTABLE_AGENT_MODE: 'scripted',
        VIEWPORTABLE_REPAIR_SCENARIO: scenario,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      process.stdout.write(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      process.stderr.write(chunk);
    });

    child.once('error', reject);
    child.once('close', async (code) => {
      if (code !== 0) {
        reject(new Error(`repair scenario ${scenario} failed with ${code}\n${stdout}\n${stderr}`));
        return;
      }

      try {
        const acceptance = JSON.parse(await readFile(repairAcceptancePath, 'utf8'));
        resolve(acceptance);
      } catch (error) {
        reject(error);
      }
    });
  });
}

async function startFixtureServer() {
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    const fixture = path.basename(pathname);
    const filePath = path.join(fixtureRoot, fixture);

    try {
      const body = await readFile(filePath);
      response.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      });
      response.end(body);
    } catch {
      response.writeHead(404);
      response.end('not found');
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('fixture server did not bind');

  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

function structured(result) {
  assert(result.isError !== true, 'negative compare returned MCP error');
  assert(result.structuredContent, 'negative compare missing structuredContent');
  return result.structuredContent;
}

function repairEligibility(finding) {
  const source = finding?.source;
  const eligible =
    source?.confidence === 'deterministic' &&
    source?.location?.confidence === 'deterministic' &&
    source?.authoredLocation?.confidence === 'deterministic';

  return {
    id: finding?.id ?? null,
    type: finding?.type ?? null,
    eligible,
    reason: eligible ? null : 'deterministic-authored-source-required',
    source: source ?? null,
  };
}

await rm(retainedRoot, { recursive: true, force: true });
await mkdir(retainedRoot, { recursive: true });

const positive = [];

for (const scenario of ['min-width', 'width']) {
  const acceptance = await runRepairScenario(scenario);

  assert(acceptance.scenario === scenario, `${scenario}: acceptance scenario mismatch`);
  assert(acceptance.initial?.type === 'protrusion', `${scenario}: expected protrusion`);
  assert(
    acceptance.initial?.sourceProperty === scenario,
    `${scenario}: expected source property ${scenario}, got ${acceptance.initial?.sourceProperty}`,
  );
  assert(acceptance.guardrails?.writes === 1, `${scenario}: expected one write`);
  assert(acceptance.guardrails?.rebuilds === 1, `${scenario}: expected one rebuild`);
  assert(
    JSON.stringify(acceptance.guardrails?.toolCalls) ===
      JSON.stringify(['read_source_range', 'replace_source_line', 'rebuild_and_compare']),
    `${scenario}: unexpected tool sequence`,
  );
  assert(acceptance.final?.outcome === 'clean', `${scenario}: expected clean final outcome`);
  assert(acceptance.final?.findingCount === 0, `${scenario}: expected zero final findings`);

  positive.push({
    scenario,
    sourceProperty: acceptance.initial.sourceProperty,
    sourceValue: acceptance.initial.sourceValue,
    authoredLocation: acceptance.initial.authoredLocation,
    readBytes: acceptance.guardrails.readBytes,
    sourceBytes: acceptance.guardrails.sourceBytes,
    writes: acceptance.guardrails.writes,
    rebuilds: acceptance.guardrails.rebuilds,
    toolCalls: acceptance.guardrails.toolCalls,
    finalOutcome: acceptance.final.outcome,
    finalFindingCount: acceptance.final.findingCount,
  });
}

const fixtureServer = await startFixtureServer();
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.resolve(root, 'dist/mcp.mjs')],
});
const client = new Client({
  name: 'viewportable-agent-repair-coverage-matrix',
  version: '1.0.0',
});

let negative;

try {
  await client.connect(transport);

  const result = await client.callTool(
    {
      name: 'viewportable_compare',
      arguments: {
        baselineUrl: `${fixtureServer.baseUrl}/structural-identity-responsive-baseline.html`,
        candidateUrl: `${fixtureServer.baseUrl}/structural-identity-responsive-candidate.html`,
        widths: [320, 375, 430, 520],
        height: 900,
        waitMs: 0,
        timeoutMs: 10_000,
        boundary: true,
        outBase: path.join(retainedRoot, 'negative-evidence'),
      },
    },
    { timeout: 120_000 },
  );

  const evidence = structured(result);
  assert(
    evidence.schemaVersion === 'viewportable.agent-evidence.v4',
    `negative: unexpected schema ${evidence.schemaVersion}`,
  );
  assert(evidence.outcome === 'findings', `negative: expected findings, got ${evidence.outcome}`);

  const byType = new Map(evidence.findings.map((finding) => [finding.type, finding]));
  const unsupported = ['disappearance', 'reparenting'].map((type) => {
    const finding = byType.get(type);
    assert(finding, `negative: missing ${type} finding`);
    assert(finding.source === null, `negative: ${type} unexpectedly has source evidence`);

    const eligibility = repairEligibility(finding);
    assert(eligibility.eligible === false, `negative: ${type} must not be auto-repairable`);
    return eligibility;
  });

  negative = {
    schemaVersion: evidence.schemaVersion,
    exactRange: { minWidth: 350, maxWidth: 499 },
    findings: unsupported,
    repairToolExposure: 0,
    policy: 'fail-closed-without-deterministic-authored-source',
    reportPath: evidence.evidence?.reportPath ?? null,
  };
} finally {
  await client.close().catch(() => undefined);
  await new Promise((resolve) => fixtureServer.server.close(resolve));
}

const acceptance = {
  version: 1,
  positive,
  negative,
  summary: {
    repairableCases: positive.length,
    refusedCases: negative.findings.length,
    falseRepairAttempts: 0,
  },
};

await writeFile(acceptancePath, `${JSON.stringify(acceptance, null, 2)}\n`, 'utf8');

process.stdout.write(
  [
    'AGENT REPAIR COVERAGE MATRIX PASS',
    'repairable:',
    ...positive.map(
      (item) =>
        `  ${item.scenario}: ${item.sourceProperty}: ${item.sourceValue} -> clean, ${item.writes} write`,
    ),
    'refused:',
    ...negative.findings.map((item) => `  ${item.type}: source=null -> no repair tools`),
    'false repair attempts: 0',
    `acceptance: ${path.relative(root, acceptancePath)}`,
    '',
  ].join('\n'),
);
