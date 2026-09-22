import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtureRoot = path.join(root, 'test/fixtures/build-tool-source-map');
const retainedRoot = path.join(root, '.slice/build-tool-scan-agent-repair');
const evidenceRoot = path.join(retainedRoot, 'evidence');
const acceptancePath = path.join(retainedRoot, 'acceptance.json');
const tempRoot = await mkdtemp(path.join(tmpdir(), 'viewportable-scan-agent-repair-'));
const appRoot = path.join(tempRoot, 'app');
const distRoot = path.join(appRoot, 'dist');
const targetPath = path.join(appRoot, 'src/Candidate.source.scss');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function run(command, args, { cwd = root, allowed = [0], capture = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, NO_COLOR: '1' },
      stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    });

    let stdout = '';
    let stderr = '';

    if (capture) {
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        stdout += chunk;
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk;
      });
    }

    child.once('error', reject);
    child.once('close', (code) => {
      const exitCode = code ?? 2;
      if (!allowed.includes(exitCode)) {
        reject(new Error(`${command} ${args.join(' ')} exited ${exitCode}\n${stdout}\n${stderr}`));
        return;
      }
      resolve({ code: exitCode, stdout, stderr });
    });
  });
}

async function compileCandidate() {
  const outputRoot = path.join(appRoot, 'public/precompiled');
  await mkdir(outputRoot, { recursive: true });
  await run(
    'npm',
    [
      'exec',
      '--',
      'sass',
      '--source-map',
      '--embed-sources',
      '--style=expanded',
      'src/Candidate.source.scss',
      'public/precompiled/candidate.css',
    ],
    { cwd: appRoot },
  );
}

async function buildProduction() {
  await compileCandidate();
  await run('npm', ['exec', '--', 'vite', 'build'], { cwd: appRoot });
}

async function startStaticServer(directory) {
  const server = createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
      const relative = decodeURIComponent(requestUrl.pathname).replace(/^\/+/, '');
      const requested = relative || 'candidate.html';
      const absolute = path.resolve(directory, requested);
      const rootPrefix = `${path.resolve(directory)}${path.sep}`;

      if (absolute !== path.resolve(directory) && !absolute.startsWith(rootPrefix)) {
        response.writeHead(403);
        response.end('forbidden');
        return;
      }

      const body = await readFile(absolute);
      const extension = path.extname(absolute);
      const contentType =
        extension === '.html'
          ? 'text/html; charset=utf-8'
          : extension === '.js'
            ? 'text/javascript; charset=utf-8'
            : extension === '.css'
              ? 'text/css; charset=utf-8'
              : extension === '.map'
                ? 'application/json; charset=utf-8'
                : 'application/octet-stream';

      response.writeHead(200, {
        'content-type': contentType,
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

function structured(result, phase) {
  assert(result.isError !== true, `${phase}: MCP tool returned isError`);
  assert(
    result.structuredContent && typeof result.structuredContent === 'object',
    `${phase}: missing structuredContent`,
  );
  return result.structuredContent;
}

await rm(retainedRoot, { recursive: true, force: true });
await mkdir(evidenceRoot, { recursive: true });
await cp(fixtureRoot, appRoot, { recursive: true });

const originalSource = await readFile(targetPath, 'utf8');
const originalLines = originalSource.split('\n');
let fixtureServer;
let client;

try {
  process.stdout.write(
    [
      'REAL BUILD TOOL SCAN AGENT REPAIR E2E',
      'toolchain: Vite 8.3.0 + Sass 1.104.1 + React 19.3.0',
      '',
    ].join('\n'),
  );

  await run(
    'npm',
    ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false'],
    { cwd: appRoot },
  );
  await buildProduction();

  fixtureServer = await startStaticServer(distRoot);

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.resolve(root, 'dist/mcp.mjs')],
  });

  client = new Client({
    name: 'viewportable-build-tool-scan-agent-repair',
    version: '1.0.0',
  });
  await client.connect(transport);

  async function scan(phase) {
    const call = await client.callTool(
      {
        name: 'viewportable_scan',
        arguments: {
          url: `${fixtureServer.baseUrl}/candidate.html`,
          widths: [320, 375, 430, 520],
          height: 900,
          waitMs: 0,
          timeoutMs: 10_000,
          boundary: true,
          readySelector: '#subject',
          outBase: evidenceRoot,
        },
      },
      { timeout: 120_000 },
    );

    return structured(call, phase);
  }

  const broken = await scan('before');
  assert(
    broken.schemaVersion === 'viewportable.agent-evidence.v4',
    `before: unexpected schema ${broken.schemaVersion}`,
  );
  assert(broken.mode === 'scan', `before: expected scan mode, got ${broken.mode}`);
  assert(broken.outcome === 'findings', `before: expected findings, got ${broken.outcome}`);
  assert(broken.exitCode === 1, `before: expected exit 1, got ${broken.exitCode}`);

  const finding = broken.findings.find(
    (entry) =>
      entry.type === 'horizontal-overflow' &&
      entry.source?.property === 'min-width' &&
      entry.source?.authoredLocation,
  );
  assert(finding, 'before: missing horizontal-overflow finding with authored min-width source');

  const source = finding.source;
  const authored = source.authoredLocation;
  assert(source.location?.coordinateSpace === 'stylesheet', 'before: missing stylesheet location');
  assert(
    authored.coordinateSpace === 'authored-source',
    'before: missing authored source location',
  );
  assert(
    authored.source.endsWith('Candidate.source.scss'),
    `before: unexpected authored source ${authored.source}`,
  );
  assert(
    authored.start?.line === 16,
    `before: expected authored line 16, got ${authored.start?.line}`,
  );
  assert(
    authored.start?.column === 5,
    `before: expected authored column 5, got ${authored.start?.column}`,
  );

  const targetLine = authored.start.line;
  const readStart = Math.max(1, targetLine - 2);
  const readEnd = Math.min(originalLines.length, targetLine + 1);
  const readLines = originalLines.slice(readStart - 1, readEnd);
  const readText = readLines.map((line, index) => `${readStart + index}: ${line}`).join('\n');
  const readBytes = Buffer.byteLength(readText);
  assert(readEnd - readStart + 1 <= 5, 'repair read exceeded five lines');
  assert(readBytes < Buffer.byteLength(originalSource), 'repair read exposed full source');

  const expectedLine = originalLines[targetLine - 1];
  assert(
    expectedLine.trim().startsWith('min-width:'),
    `before: attributed line does not start with min-width: ${expectedLine}`,
  );

  const repairedLines = [...originalLines];
  repairedLines[targetLine - 1] = '';
  await writeFile(targetPath, repairedLines.join('\n'), 'utf8');

  await buildProduction();
  const fixed = await scan('after');

  assert(fixed.mode === 'scan', `after: expected scan mode, got ${fixed.mode}`);
  assert(fixed.outcome === 'clean', `after: expected clean, got ${fixed.outcome}`);
  assert(fixed.exitCode === 0, `after: expected exit 0, got ${fixed.exitCode}`);
  assert(
    fixed.findings.length === 0,
    `after: expected zero findings, got ${fixed.findings.length}`,
  );

  const finalSource = await readFile(targetPath, 'utf8');
  const finalLines = finalSource.split('\n');
  const changedLines = originalLines
    .map((line, index) => ({
      line: index + 1,
      before: line,
      after: finalLines[index],
    }))
    .filter((item) => item.before !== item.after);

  assert(changedLines.length === 1, `expected one changed line, got ${changedLines.length}`);
  assert(changedLines[0].line === targetLine, `unexpected changed line ${changedLines[0].line}`);

  const acceptance = {
    version: 1,
    mode: 'scan',
    before: {
      outcome: broken.outcome,
      findingCount: broken.findings.length,
      finding: {
        type: finding.type,
        groupId: finding.groupId,
        range: finding.range,
        source,
      },
      reportPath: broken.evidence?.reportPath,
    },
    repair: {
      readStart,
      readEnd,
      readBytes,
      sourceBytes: Buffer.byteLength(originalSource),
      editedLine: targetLine,
      before: expectedLine,
      after: '',
    },
    after: {
      outcome: fixed.outcome,
      exitCode: fixed.exitCode,
      findingCount: fixed.findings.length,
      reportPath: fixed.evidence?.reportPath,
    },
  };

  await writeFile(acceptancePath, `${JSON.stringify(acceptance, null, 2)}\n`, 'utf8');

  process.stdout.write(
    [
      'REAL BUILD TOOL SCAN AGENT REPAIR E2E PASS',
      `before: horizontal-overflow with ${source.property}: ${source.value}`,
      `generated: ${source.stylesheet}`,
      `authored: ${authored.source}:${authored.start.line}:${authored.start.column}`,
      `source bytes read: ${readBytes} / ${Buffer.byteLength(originalSource)}`,
      'agent writes: 1',
      `after: ${fixed.findings.length} findings`,
      `acceptance: ${path.relative(root, acceptancePath)}`,
      '',
    ].join('\n'),
  );
} finally {
  await client?.close().catch(() => undefined);
  if (fixtureServer) {
    await new Promise((resolve) => fixtureServer.server.close(resolve));
  }
  await rm(tempRoot, { recursive: true, force: true });
}
