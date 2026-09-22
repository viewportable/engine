import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { createServer } from 'node:http';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const widths = [320, 375, 430, 520];
const outRoot = resolve('.slice/mcp-golden-agent');
const evidenceRoot = resolve(outRoot, 'evidence');
const acceptancePath = resolve(outRoot, 'acceptance.json');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function serve(getHtml) {
  const server = createServer((request, response) => {
    if (request.url !== '/' && request.url !== '/index.html') {
      response.writeHead(404);
      response.end('not found');
      return;
    }

    const body = getHtml();
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'content-length': Buffer.byteLength(body),
      'cache-control': 'no-store',
    });
    response.end(body);
  });

  return new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('fixture server did not expose a TCP port'));
        return;
      }
      resolveListen({
        server,
        url: `http://127.0.0.1:${address.port}`,
      });
    });
  });
}

function brokenCandidate(baseline) {
  const changed = baseline.replace(
    'Baseline structure is intentionally stable.',
    'Agent candidate intentionally regresses structure from 350px through 499px.',
  );

  return changed.replace(
    '  </body>',
    `    <script>
      const pageRoot = document.querySelector('#page-root');
      const pricingCard = document.querySelector('#pricing-card');
      const cta = document.querySelector('#cta');
      const checkoutButton = document.querySelector('#checkout-button');

      function applyGoldenRegression() {
        const regressed = window.innerWidth >= 350 && window.innerWidth <= 499;

        (regressed ? pageRoot : pricingCard).appendChild(cta);
        checkoutButton.style.display = regressed ? 'none' : 'block';
      }

      applyGoldenRegression();
      window.addEventListener('resize', applyGoldenRegression);
    </script>
  </body>`,
  );
}

function fixedCandidate(baseline) {
  return baseline.replace(
    'Baseline structure is intentionally stable.',
    'Agent candidate copy changed while responsive structure remains stable.',
  );
}

function structured(result, phase) {
  assert(result.isError !== true, `${phase}: MCP tool returned isError`);
  assert(
    result.structuredContent && typeof result.structuredContent === 'object',
    `${phase}: missing structuredContent`,
  );
  return result.structuredContent;
}

function exactRange(finding) {
  return (
    finding?.range?.kind === 'exact' &&
    finding?.range?.minWidth === 350 &&
    finding?.range?.maxWidth === 499
  );
}

const baselineHtml = await readFile('examples/golden-pr/app/index.html', 'utf8');
let candidateHtml = brokenCandidate(baselineHtml);

await rm(outRoot, { recursive: true, force: true });
await mkdir(evidenceRoot, { recursive: true });

const baselineFixture = await serve(() => baselineHtml);
const candidateFixture = await serve(() => candidateHtml);

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [resolve('dist/mcp.mjs')],
});

const client = new Client({
  name: 'viewportable-golden-agent',
  version: '1.0.0',
});

try {
  await client.connect(transport);

  const listed = await client.listTools();
  const names = listed.tools.map((tool) => tool.name).sort();
  assert(
    JSON.stringify(names) === JSON.stringify(['viewportable_compare', 'viewportable_scan']),
    `unexpected MCP tools: ${JSON.stringify(names)}`,
  );

  const brokenCall = await client.callTool(
    {
      name: 'viewportable_compare',
      arguments: {
        baselineUrl: baselineFixture.url,
        candidateUrl: candidateFixture.url,
        widths,
        height: 900,
        waitMs: 0,
        timeoutMs: 10_000,
        boundary: true,
        outBase: evidenceRoot,
      },
    },
    { timeout: 120_000 },
  );
  const broken = structured(brokenCall, 'broken');

  assert(
    broken.schemaVersion === 'viewportable.agent-evidence.v3',
    `broken: unexpected schema version ${broken.schemaVersion}`,
  );
  assert(broken.outcome === 'findings', `broken: expected findings, got ${broken.outcome}`);
  assert(broken.exitCode === 1, `broken: expected exit 1, got ${broken.exitCode}`);
  assert(Array.isArray(broken.findings), 'broken: findings is not an array');
  assert(
    broken.findings.length === 2,
    `broken: expected 2 findings, got ${broken.findings.length}`,
  );

  const types = broken.findings.map((finding) => finding.type).sort();
  assert(
    JSON.stringify(types) === JSON.stringify(['disappearance', 'reparenting']),
    `broken: unexpected finding types ${JSON.stringify(types)}`,
  );
  assert(
    broken.findings.every(exactRange),
    `broken: findings do not share exact 350-499px range: ${JSON.stringify(broken.findings)}`,
  );

  candidateHtml = fixedCandidate(baselineHtml);

  const fixedCall = await client.callTool(
    {
      name: 'viewportable_compare',
      arguments: {
        baselineUrl: baselineFixture.url,
        candidateUrl: candidateFixture.url,
        widths,
        height: 900,
        waitMs: 0,
        timeoutMs: 10_000,
        boundary: true,
        outBase: evidenceRoot,
      },
    },
    { timeout: 120_000 },
  );
  const fixed = structured(fixedCall, 'fixed');

  assert(
    fixed.schemaVersion === 'viewportable.agent-evidence.v3',
    `fixed: unexpected schema version ${fixed.schemaVersion}`,
  );
  assert(fixed.outcome === 'clean', `fixed: expected clean, got ${fixed.outcome}`);
  assert(fixed.exitCode === 0, `fixed: expected exit 0, got ${fixed.exitCode}`);
  assert(Array.isArray(fixed.findings), 'fixed: findings is not an array');
  assert(fixed.findings.length === 0, `fixed: expected 0 findings, got ${fixed.findings.length}`);

  const acceptance = {
    version: 1,
    transport: 'stdio',
    tools: names,
    widths,
    broken: {
      outcome: broken.outcome,
      exitCode: broken.exitCode,
      findingTypes: types,
      exactRange: { minWidth: 350, maxWidth: 499 },
      reportPath: broken.reportPath,
    },
    fixed: {
      outcome: fixed.outcome,
      exitCode: fixed.exitCode,
      findingCount: fixed.findings.length,
      reportPath: fixed.reportPath,
    },
  };

  await writeFile(acceptancePath, `${JSON.stringify(acceptance, null, 2)}\n`);

  process.stdout.write(
    [
      'MCP GOLDEN AGENT FLOW PASS',
      `broken: 2 findings @ 350-499px exact (${types.join(', ')})`,
      'fixed: 0 findings',
      `acceptance: ${acceptancePath}`,
      `broken evidence: ${broken.reportPath}`,
      `fixed evidence: ${fixed.reportPath}`,
      '',
    ].join('\n'),
  );
} finally {
  await client.close().catch(() => undefined);
  await Promise.all([
    new Promise((resolveClose) => baselineFixture.server.close(resolveClose)),
    new Promise((resolveClose) => candidateFixture.server.close(resolveClose)),
  ]);
}
