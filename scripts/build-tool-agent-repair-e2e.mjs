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
const retainedRoot = path.join(root, '.slice/build-tool-agent-repair');
const evidenceRoot = path.join(retainedRoot, 'evidence');
const acceptancePath = path.join(retainedRoot, 'acceptance.json');
const tempRoot = await mkdtemp(path.join(tmpdir(), 'viewportable-agent-repair-'));
const appRoot = path.join(tempRoot, 'app');
const distRoot = path.join(appRoot, 'dist');
const targetPath = path.join(appRoot, 'src/Candidate.source.scss');
const mode = process.env.VIEWPORTABLE_AGENT_MODE ?? 'scripted';
const model = process.env.OPENAI_MODEL ?? 'gpt-5.6';
const apiKey = process.env.OPENAI_API_KEY ?? process.env.OPEN_API_TOKEN ?? '';

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

async function compileSass(sourceName, outputName) {
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
      `src/${sourceName}`,
      `public/precompiled/${outputName}`,
    ],
    { cwd: appRoot },
  );
}

async function buildProduction({ initial = false } = {}) {
  if (initial) {
    await compileSass('Baseline.source.scss', 'baseline.css');
  }
  await compileSass('Candidate.source.scss', 'candidate.css');
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

function oneFunctionCall(response, expectedName) {
  const calls = Array.isArray(response.output)
    ? response.output.filter((item) => item?.type === 'function_call')
    : [];

  assert(calls.length === 1, `expected one ${expectedName} call, got ${calls.length}`);
  const call = calls[0];
  assert(call.name === expectedName, `expected ${expectedName}, got ${call.name}`);
  assert(typeof call.call_id === 'string' && call.call_id, `${expectedName}: missing call_id`);

  let args;
  try {
    args = JSON.parse(call.arguments);
  } catch {
    throw new Error(`${expectedName}: invalid JSON arguments`);
  }

  return { call, args };
}

function responseText(response) {
  const chunks = [];
  for (const item of response.output ?? []) {
    if (item?.type !== 'message') continue;
    for (const content of item.content ?? []) {
      if (content?.type === 'output_text' && typeof content.text === 'string') {
        chunks.push(content.text);
      }
    }
  }
  return chunks.join('\n').trim();
}

function tool(name, description, properties, required) {
  return {
    type: 'function',
    name,
    description,
    strict: true,
    parameters: {
      type: 'object',
      properties,
      required,
      additionalProperties: false,
    },
  };
}

const readTool = tool(
  'read_source_range',
  'Read a small line range around the deterministic authored source location. Full-file reads are unavailable.',
  {
    source: {
      type: 'string',
      description: 'The exact authored source identifier from Viewportable evidence.',
    },
    startLine: {
      type: 'integer',
      minimum: 1,
      description: 'First 1-based line to read.',
    },
    endLine: {
      type: 'integer',
      minimum: 1,
      description: 'Last 1-based line to read. At most five lines total.',
    },
  },
  ['source', 'startLine', 'endLine'],
);

const replaceTool = tool(
  'replace_source_line',
  'Replace exactly the attributed authored source line. Only one write is permitted.',
  {
    source: {
      type: 'string',
      description: 'The exact authored source identifier from Viewportable evidence.',
    },
    line: {
      type: 'integer',
      minimum: 1,
      description: 'The exact 1-based authored line to replace.',
    },
    expected: {
      type: 'string',
      description: 'The exact current line content returned by read_source_range.',
    },
    replacement: {
      type: 'string',
      maxLength: 120,
      description: 'Single-line replacement. Use an empty string to delete the declaration line.',
    },
  },
  ['source', 'line', 'expected', 'replacement'],
);

const rebuildTool = tool(
  'rebuild_and_compare',
  'Recompile the edited Sass, rebuild the Vite production app, and rerun Viewportable comparison.',
  {},
  [],
);

async function openAiResponse({ input, previousResponseId, tools = [], toolChoice }) {
  assert(apiKey, 'OPENAI_API_KEY or OPEN_API_TOKEN is required for openai mode');

  const body = {
    model,
    input,
    parallel_tool_calls: false,
    ...(previousResponseId ? { previous_response_id: previousResponseId } : {}),
    ...(tools.length ? { tools } : {}),
    ...(toolChoice ? { tool_choice: toolChoice } : {}),
  };

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(
      `OpenAI Responses API failed ${response.status}: ${JSON.stringify(payload).slice(0, 2000)}`,
    );
  }
  return payload;
}

function forcedTool(name) {
  return { type: 'function', name };
}

await rm(retainedRoot, { recursive: true, force: true });
await mkdir(evidenceRoot, { recursive: true });
await cp(fixtureRoot, appRoot, { recursive: true });

const originalSource = await readFile(targetPath, 'utf8');
const sourceByteLength = Buffer.byteLength(originalSource);
let readBytes = 0;
let writes = 0;
let rebuilds = 0;
let editRecord = null;
const trace = [];
const responseIds = [];
const usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

let fixtureServer;
let client;

try {
  process.stdout.write(
    [
      'REAL BUILD TOOL AGENT REPAIR E2E',
      `mode: ${mode}`,
      `model: ${mode === 'openai' ? model : 'scripted'}`,
      'toolchain: Vite 8.3.0 + Sass 1.104.1 + React 19.3.0 + CSS Modules + PostCSS',
      '',
    ].join('\n'),
  );

  await run(
    'npm',
    ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false'],
    { cwd: appRoot },
  );
  await buildProduction({ initial: true });

  fixtureServer = await startStaticServer(distRoot);

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.resolve(root, 'dist/mcp.mjs')],
  });

  client = new Client({
    name: 'viewportable-build-tool-agent-repair',
    version: '1.0.0',
  });
  await client.connect(transport);

  async function compare(phase) {
    const call = await client.callTool(
      {
        name: 'viewportable_compare',
        arguments: {
          baselineUrl: `${fixtureServer.baseUrl}/baseline.html`,
          candidateUrl: `${fixtureServer.baseUrl}/candidate.html`,
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

  const broken = await compare('before');
  assert(
    broken.schemaVersion === 'viewportable.agent-evidence.v4',
    `before: unexpected schema version ${broken.schemaVersion}`,
  );
  assert(broken.outcome === 'findings', `before: expected findings, got ${broken.outcome}`);
  assert(broken.exitCode === 1, `before: expected exit 1, got ${broken.exitCode}`);
  assert(
    broken.findings?.length === 1,
    `before: expected 1 finding, got ${broken.findings?.length}`,
  );

  const finding = broken.findings[0];
  assert(finding.type === 'protrusion', `before: unexpected finding ${finding.type}`);
  assert(
    finding.range?.kind === 'exact' &&
      finding.range.minWidth === 350 &&
      finding.range.maxWidth === 499,
    `before: unexpected range ${JSON.stringify(finding.range)}`,
  );

  const authored = finding.source?.authoredLocation;
  assert(authored, 'before: missing authoredLocation');
  assert(
    authored.source === '../../src/Candidate.source.scss',
    `before: unexpected authored source ${authored.source}`,
  );
  assert(
    authored.start?.line === 16 && authored.start?.column === 5,
    `before: unexpected authored start ${JSON.stringify(authored.start)}`,
  );

  const targetSource = authored.source;
  const targetLine = authored.start.line;

  async function readSourceRange({ source, startLine, endLine }) {
    assert(source === targetSource, `read: source must be ${targetSource}`);
    assert(
      Number.isInteger(startLine) && Number.isInteger(endLine),
      'read: lines must be integers',
    );
    assert(startLine >= 1 && endLine >= startLine, 'read: invalid line range');
    assert(endLine - startLine + 1 <= 5, 'read: at most five lines are allowed');
    assert(
      startLine <= targetLine && endLine >= targetLine,
      'read: range must include attributed line',
    );

    const content = await readFile(targetPath, 'utf8');
    const lines = content.split('\n');
    assert(endLine <= lines.length, 'read: range exceeds source length');

    const selected = [];
    for (let line = startLine; line <= endLine; line += 1) {
      selected.push({ line, text: lines[line - 1] });
    }

    const rendered = selected.map((item) => `${item.line}: ${item.text}`).join('\n');
    const bytes = Buffer.byteLength(rendered);
    readBytes += bytes;
    assert(readBytes <= 320, `read budget exceeded: ${readBytes} bytes`);

    trace.push({ tool: 'read_source_range', source, startLine, endLine, bytes });
    return {
      source,
      startLine,
      endLine,
      lines: selected,
      bytes,
      fullSourceAvailable: false,
    };
  }

  async function replaceSourceLine({ source, line, expected, replacement }) {
    assert(source === targetSource, `replace: source must be ${targetSource}`);
    assert(line === targetLine, `replace: line must be attributed line ${targetLine}`);
    assert(writes === 0, 'replace: only one write is permitted');
    assert(typeof expected === 'string', 'replace: expected must be a string');
    assert(typeof replacement === 'string', 'replace: replacement must be a string');
    assert(!replacement.includes('\n') && !replacement.includes('\r'), 'replace: one line only');
    assert(replacement.length <= 120, 'replace: replacement too long');

    const content = await readFile(targetPath, 'utf8');
    const lines = content.split('\n');
    const current = lines[line - 1];
    assert(
      current === expected,
      `replace: expected line mismatch; current=${JSON.stringify(current)}`,
    );
    assert(replacement !== current, 'replace: replacement must change the line');

    lines[line - 1] = replacement;
    await writeFile(targetPath, lines.join('\n'), 'utf8');

    writes += 1;
    editRecord = { source, line, before: current, after: replacement };
    trace.push({ tool: 'replace_source_line', source, line, before: current, after: replacement });

    return {
      source,
      line,
      before: current,
      after: replacement,
      writes,
    };
  }

  async function rebuildAndCompare() {
    assert(writes === 1, 'rebuild: exactly one source write is required first');
    assert(rebuilds === 0, 'rebuild: only one repair verification is permitted');

    rebuilds += 1;
    await buildProduction();
    const result = await compare('after');
    trace.push({
      tool: 'rebuild_and_compare',
      outcome: result.outcome,
      findingCount: result.summary?.findingCount,
    });
    return result;
  }

  const handlers = {
    read_source_range: readSourceRange,
    replace_source_line: replaceSourceLine,
    rebuild_and_compare: rebuildAndCompare,
  };

  let finalText = '';

  if (mode === 'scripted') {
    const readResult = await readSourceRange({
      source: targetSource,
      startLine: targetLine - 2,
      endLine: targetLine + 1,
    });
    const target = readResult.lines.find((item) => item.line === targetLine);
    assert(target, 'scripted: attributed line not returned');

    await replaceSourceLine({
      source: targetSource,
      line: targetLine,
      expected: target.text,
      replacement: '',
    });

    const repaired = await rebuildAndCompare();
    assert(repaired.outcome === 'clean', `scripted: expected clean, got ${repaired.outcome}`);
    finalText = 'Repair verified clean.';
  } else if (mode === 'openai') {
    const instructions = [
      'You repair one deterministic responsive regression using only the supplied tools.',
      'The Viewportable V4 evidence is authoritative.',
      'First read a small range around the authored location.',
      'Then make exactly one single-line edit to the attributed authored line.',
      'Use the smallest fix that removes the attributed min-width regression.',
      'Do not request or infer the full source file.',
      'After editing, rebuild and compare.',
      'Finish only after the comparison reports outcome clean and zero findings.',
    ].join(' ');

    const first = await openAiResponse({
      input: `${instructions}\n\nV4 evidence:\n${JSON.stringify(broken, null, 2)}`,
      tools: [readTool],
      toolChoice: forcedTool('read_source_range'),
    });
    responseIds.push(first.id);
    usage.inputTokens += first.usage?.input_tokens ?? 0;
    usage.outputTokens += first.usage?.output_tokens ?? 0;
    usage.totalTokens += first.usage?.total_tokens ?? 0;

    const firstCall = oneFunctionCall(first, 'read_source_range');
    const firstResult = await handlers.read_source_range(firstCall.args);

    const second = await openAiResponse({
      previousResponseId: first.id,
      input: [
        {
          type: 'function_call_output',
          call_id: firstCall.call.call_id,
          output: JSON.stringify(firstResult),
        },
      ],
      tools: [replaceTool],
      toolChoice: forcedTool('replace_source_line'),
    });
    responseIds.push(second.id);
    usage.inputTokens += second.usage?.input_tokens ?? 0;
    usage.outputTokens += second.usage?.output_tokens ?? 0;
    usage.totalTokens += second.usage?.total_tokens ?? 0;

    const secondCall = oneFunctionCall(second, 'replace_source_line');
    const secondResult = await handlers.replace_source_line(secondCall.args);

    const third = await openAiResponse({
      previousResponseId: second.id,
      input: [
        {
          type: 'function_call_output',
          call_id: secondCall.call.call_id,
          output: JSON.stringify(secondResult),
        },
      ],
      tools: [rebuildTool],
      toolChoice: forcedTool('rebuild_and_compare'),
    });
    responseIds.push(third.id);
    usage.inputTokens += third.usage?.input_tokens ?? 0;
    usage.outputTokens += third.usage?.output_tokens ?? 0;
    usage.totalTokens += third.usage?.total_tokens ?? 0;

    const thirdCall = oneFunctionCall(third, 'rebuild_and_compare');
    const thirdResult = await handlers.rebuild_and_compare(thirdCall.args);

    const fourth = await openAiResponse({
      previousResponseId: third.id,
      input: [
        {
          type: 'function_call_output',
          call_id: thirdCall.call.call_id,
          output: JSON.stringify(thirdResult),
        },
      ],
    });
    responseIds.push(fourth.id);
    usage.inputTokens += fourth.usage?.input_tokens ?? 0;
    usage.outputTokens += fourth.usage?.output_tokens ?? 0;
    usage.totalTokens += fourth.usage?.total_tokens ?? 0;
    finalText = responseText(fourth);
    assert(finalText, 'openai: missing final response text');
  } else {
    throw new Error(`unsupported VIEWPORTABLE_AGENT_MODE: ${mode}`);
  }

  assert(
    JSON.stringify(trace.map((item) => item.tool)) ===
      JSON.stringify(['read_source_range', 'replace_source_line', 'rebuild_and_compare']),
    `unexpected tool trace: ${JSON.stringify(trace)}`,
  );
  assert(writes === 1, `expected exactly one write, got ${writes}`);
  assert(rebuilds === 1, `expected exactly one rebuild, got ${rebuilds}`);
  assert(readBytes > 0 && readBytes < sourceByteLength, `invalid narrow read size ${readBytes}`);

  const final = await compare('final-proof');
  assert(final.outcome === 'clean', `final: expected clean, got ${final.outcome}`);
  assert(final.exitCode === 0, `final: expected exit 0, got ${final.exitCode}`);
  assert(final.findings?.length === 0, `final: expected 0 findings, got ${final.findings?.length}`);

  const finalSource = await readFile(targetPath, 'utf8');
  const changedLines = originalSource
    .split('\n')
    .map((line, index) => ({
      line: index + 1,
      before: line,
      after: finalSource.split('\n')[index],
    }))
    .filter((item) => item.before !== item.after);

  assert(changedLines.length === 1, `expected one changed line, got ${changedLines.length}`);
  assert(changedLines[0].line === targetLine, `unexpected changed line ${changedLines[0].line}`);

  const acceptance = {
    version: 1,
    mode,
    model: mode === 'openai' ? model : null,
    initial: {
      schemaVersion: broken.schemaVersion,
      outcome: broken.outcome,
      findingCount: broken.findings.length,
      type: finding.type,
      exactRange: { minWidth: 350, maxWidth: 499 },
      authoredLocation: authored,
      reportPath: broken.evidence?.reportPath,
    },
    guardrails: {
      sourceBytes: sourceByteLength,
      readBytes,
      fullSourceAvailable: false,
      writes,
      rebuilds,
      toolCalls: trace.map((item) => item.tool),
    },
    edit: editRecord,
    final: {
      schemaVersion: final.schemaVersion,
      outcome: final.outcome,
      exitCode: final.exitCode,
      findingCount: final.findings.length,
      reportPath: final.evidence?.reportPath,
    },
    agent: {
      finalText,
      responseIds,
      usage,
    },
  };

  await writeFile(acceptancePath, `${JSON.stringify(acceptance, null, 2)}\n`, 'utf8');

  process.stdout.write(
    [
      'REAL BUILD TOOL AGENT REPAIR E2E PASS',
      `mode: ${mode}`,
      `before: 1 protrusion @ 350-499px exact`,
      `authored: ${targetSource}:${targetLine}:${authored.start.column}`,
      `source bytes read: ${readBytes} / ${sourceByteLength}`,
      `agent writes: ${writes}`,
      `tool calls: ${trace.length} (${trace.map((item) => item.tool).join(' -> ')})`,
      `after: ${final.findings.length} findings`,
      ...(mode === 'openai' ? [`tokens: ${usage.totalTokens}`] : []),
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
