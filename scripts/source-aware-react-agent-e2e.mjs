import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) throw new Error('OPENAI_API_KEY is required');

const model = process.env.OPENAI_MODEL ?? 'gpt-5.6-terra';
const baselineRoot = resolve(process.env.REACT_BASELINE_ROOT ?? 'react-baseline');
const candidateRoot = resolve(process.env.REACT_CANDIDATE_ROOT ?? 'react-candidate');
const engineMcp = resolve('dist/mcp.mjs');
const widths = [800, 875, 925, 1000];
const expectedMinWidth = 850;
const expectedMaxWidth = 949;
const maxRounds = 10;
const maxToolCalls = 14;
const maxWrites = 3;
const stylesRelativePath = 'src/renderer/styles.css';
const stylesPath = resolve(candidateRoot, stylesRelativePath);

const regression = `

@media (min-width: 850px) and (max-width: 949px) {
  [data-viewport-id="iphone-15-pro"] {
    min-width: 800px;
  }
}
`;

const bridge = `
    <script>
      window.viewportable = {
        command() {},
        setViewportBounds() {},
        setBoardLayout() {},
        onBoardScroll() { return () => {}; },
        onBrowserState() { return () => {}; },
        saveRecording() { return Promise.resolve({ status: 'cancelled' }); }
      };
    </script>
`;

const viteConfig = `import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: 'src/renderer',
  plugins: [react()],
  server: {
    watch: {
      usePolling: true,
      interval: 100,
    },
  },
})
`;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function prepareRenderer(root) {
  const indexPath = resolve(root, 'src/renderer/index.html');
  const index = await readFile(indexPath, 'utf8');
  const marker = '<script type="module" src="/main.tsx"></script>';
  assert(index.includes(marker), 'renderer index marker missing');
  await writeFile(indexPath, index.replace(marker, `${bridge}    ${marker}`), 'utf8');
  await writeFile(resolve(root, 'agent-vite.config.mjs'), viteConfig, 'utf8');
}

async function appendRegression() {
  const styles = await readFile(stylesPath, 'utf8');
  assert(!styles.includes(regression.trim()), 'candidate regression already present');
  await writeFile(stylesPath, `${styles.trimEnd()}${regression}\n`, 'utf8');
}

function startVite(root, port) {
  const viteCli = resolve(candidateRoot, 'node_modules/vite/bin/vite.js');
  const config = resolve(root, 'agent-vite.config.mjs');
  const child = spawn(
    process.execPath,
    [viteCli, '--config', config, '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    {
      cwd: root,
      env: { ...process.env, NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  let output = '';
  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');
  child.stdout?.on('data', (chunk) => {
    output += chunk;
  });
  child.stderr?.on('data', (chunk) => {
    output += chunk;
  });

  return { child, output: () => output };
}

async function waitFor(url, processInfo) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (processInfo.child.exitCode !== null) {
      throw new Error(`Vite exited before readiness: ${processInfo.output()}`);
    }

    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Still starting.
    }

    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }

  throw new Error(`Vite did not become ready: ${processInfo.output()}`);
}

async function stopProcess(info) {
  if (info.child.exitCode !== null) return;
  info.child.kill('SIGTERM');
  await new Promise((resolveExit) => {
    const timer = setTimeout(() => {
      info.child.kill('SIGKILL');
      resolveExit();
    }, 2_000);
    info.child.once('exit', () => {
      clearTimeout(timer);
      resolveExit();
    });
  });
}

const tools = [
  {
    type: 'function',
    name: 'viewportable_compare',
    description:
      'Run Viewportable Canonical Agent Evidence V2 against the real baseline and candidate React renderer. Call this first and after every source edit. Use finding.source when present. Success requires outcome clean.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: 'function',
    name: 'read_attributed_source_context',
    description:
      'Read a small local context around a deterministic finding.source CSS declaration. Arguments must exactly match a source attribution returned by the latest viewportable_compare. This does not expose the full stylesheet.',
    parameters: {
      type: 'object',
      properties: {
        stylesheet: { type: 'string' },
        selector: { type: 'string' },
        property: { type: 'string', enum: ['min-width', 'width'] },
        value: { type: 'string' },
        media: { type: ['string', 'null'] },
      },
      required: ['stylesheet', 'selector', 'property', 'value', 'media'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: 'function',
    name: 'replace_in_styles',
    description:
      'Apply one exact minimal replacement to src/renderer/styles.css. oldText must occur exactly once. Never rewrite the whole file.',
    parameters: {
      type: 'object',
      properties: {
        oldText: {
          type: 'string',
          minLength: 1,
          description: 'Exact existing text to replace. It must occur exactly once.',
        },
        newText: {
          type: 'string',
          description: 'Replacement text. May be empty when removing the erroneous block.',
        },
      },
      required: ['oldText', 'newText'],
      additionalProperties: false,
    },
    strict: true,
  },
];

const instructions = [
  'You are repairing a real React renderer from the viewportable/viewportable repository.',
  'The candidate contains one controlled responsive regression.',
  'Your FIRST tool call must be viewportable_compare.',
  'Viewportable returns Canonical Agent Evidence V2. Prefer deterministic finding.source over broad code search.',
  'You do NOT have a full-file read tool.',
  'When a relevant finding has source, call read_attributed_source_context with that exact source object.',
  'Use replace_in_styles for the smallest exact fix.',
  'After every edit, call viewportable_compare again.',
  'Stop only after Viewportable reports outcome clean.',
].join('\n');

async function createResponse(input) {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      store: false,
      reasoning: { effort: 'medium' },
      max_output_tokens: 3000,
      parallel_tool_calls: false,
      instructions,
      input,
      tools,
    }),
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`OpenAI Responses API failed with HTTP ${response.status}: ${body.slice(0, 2000)}`);
  }

  return JSON.parse(body);
}

function finalText(response) {
  const parts = [];
  for (const item of response.output ?? []) {
    if (item.type !== 'message') continue;
    for (const content of item.content ?? []) {
      if (content.type === 'output_text' && typeof content.text === 'string') parts.push(content.text);
    }
  }
  return parts.join('\n').trim();
}

function sourceKey(source) {
  return JSON.stringify({
    stylesheet: source.stylesheet,
    selector: source.selector,
    property: source.property,
    value: source.value,
    media: source.media,
  });
}

function sourcePathMatchesStylesheet(stylesheet) {
  const normalized = String(stylesheet ?? '').replaceAll('\\', '/');
  return normalized.endsWith('/src/renderer/styles.css') || normalized === stylesRelativePath;
}

function localContext(css, source) {
  const lines = css.split('\n');
  let index = lines.findIndex((line) => line.includes(source.selector));

  if (index < 0 && source.media) {
    index = lines.findIndex((line) => line.includes(source.media));
  }
  if (index < 0) {
    index = lines.findIndex(
      (line) => line.includes(source.property) && line.includes(source.value),
    );
  }

  assert(index >= 0, `attributed declaration not found in styles.css: ${sourceKey(source)}`);

  const start = Math.max(0, index - 5);
  const end = Math.min(lines.length, index + 8);
  const context = lines.slice(start, end).join('\n');
  assert(Buffer.byteLength(context) <= 1_500, 'attributed source context exceeded 1500 bytes');

  return {
    path: stylesRelativePath,
    startLine: start + 1,
    endLine: end,
    content: context,
  };
}

await prepareRenderer(baselineRoot);
await prepareRenderer(candidateRoot);
const baselineStyles = await readFile(resolve(baselineRoot, stylesRelativePath), 'utf8');
await appendRegression();

const baselineServer = startVite(baselineRoot, 5173);
const candidateServer = startVite(candidateRoot, 5174);
const baselineUrl = 'http://127.0.0.1:5173';
const candidateUrl = 'http://127.0.0.1:5174';

const mcpTransport = new StdioClientTransport({
  command: process.execPath,
  args: [engineMcp],
});
const mcpClient = new Client({
  name: 'viewportable-source-aware-react-agent-e2e',
  version: '1.0.0',
});

const toolHistory = [];
const compareHistory = [];
const responseIds = [];
const usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
let latestAllowedSources = new Map();
let toolCalls = 0;
let writes = 0;
let totalSourceContextBytes = 0;
let finalOutput = '';

async function runCompare() {
  const result = await mcpClient.callTool(
    {
      name: 'viewportable_compare',
      arguments: {
        baselineUrl,
        candidateUrl,
        widths,
        height: 900,
        waitMs: 300,
        timeoutMs: 30_000,
        boundary: true,
        outBase: '.slice/source-aware-react-agent-e2e',
      },
    },
    { timeout: 120_000 },
  );

  if (result.isError === true) {
    throw new Error(
      `Viewportable MCP returned isError: ${JSON.stringify(result.structuredContent ?? result.content)}`,
    );
  }

  const evidence = result.structuredContent;
  assert(evidence && typeof evidence === 'object', 'missing Viewportable structuredContent');
  assert(
    evidence.schemaVersion === 'viewportable.agent-evidence.v2',
    `unexpected evidence schema: ${evidence.schemaVersion}`,
  );

  latestAllowedSources = new Map();
  for (const finding of evidence.findings ?? []) {
    if (finding.source) latestAllowedSources.set(sourceKey(finding.source), finding.source);
  }

  compareHistory.push(evidence);
  return evidence;
}

async function runTool(name, args) {
  toolCalls += 1;
  assert(toolCalls <= maxToolCalls, `tool-call limit exceeded: ${toolCalls}`);
  if (toolHistory.length === 0) {
    assert(name === 'viewportable_compare', `first tool must be viewportable_compare, got ${name}`);
  }

  if (name === 'viewportable_compare') {
    const evidence = await runCompare();
    toolHistory.push({
      name,
      outcome: evidence.outcome,
      findingCount: evidence.summary?.findingCount ?? null,
      attributedFindingCount: (evidence.findings ?? []).filter((finding) => finding.source).length,
    });
    return evidence;
  }

  if (name === 'read_attributed_source_context') {
    const key = sourceKey(args);
    const source = latestAllowedSources.get(key);
    assert(source, `requested source was not returned by the latest Viewportable compare: ${key}`);
    assert(sourcePathMatchesStylesheet(source.stylesheet), `attributed stylesheet is not the allowed styles.css: ${source.stylesheet}`);

    const css = await readFile(stylesPath, 'utf8');
    const context = localContext(css, source);
    const bytes = Buffer.byteLength(context.content);
    totalSourceContextBytes += bytes;

    toolHistory.push({
      name,
      path: context.path,
      bytes,
      startLine: context.startLine,
      endLine: context.endLine,
      selector: source.selector,
      property: source.property,
      media: source.media,
    });
    return context;
  }

  if (name === 'replace_in_styles') {
    writes += 1;
    assert(writes <= maxWrites, `write limit exceeded: ${writes}`);
    assert(typeof args.oldText === 'string' && args.oldText.length > 0, 'oldText is required');
    assert(typeof args.newText === 'string', 'newText must be a string');

    const current = await readFile(stylesPath, 'utf8');
    const occurrences = current.split(args.oldText).length - 1;
    assert(occurrences === 1, `oldText must occur exactly once in styles.css; found ${occurrences}`);

    const next = current.replace(args.oldText, args.newText);
    await writeFile(stylesPath, `${next.trimEnd()}\n`, 'utf8');
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));

    toolHistory.push({
      name,
      removedBytes: Buffer.byteLength(args.oldText),
      addedBytes: Buffer.byteLength(args.newText),
    });
    return {
      ok: true,
      removedBytes: Buffer.byteLength(args.oldText),
      addedBytes: Buffer.byteLength(args.newText),
    };
  }

  throw new Error(`unknown tool: ${name}`);
}

try {
  await Promise.all([waitFor(baselineUrl, baselineServer), waitFor(candidateUrl, candidateServer)]);
  await new Promise((resolveWait) => setTimeout(resolveWait, 2_000));
  await mcpClient.connect(mcpTransport);

  const preflight = await runCompare();
  const attributed = (preflight.findings ?? []).find(
    (finding) =>
      finding.type === 'protrusion' &&
      finding.subject?.identity === 'data-testid:viewport-scroll-zone-iphone-15-pro' &&
      finding.range?.kind === 'exact' &&
      finding.range?.minWidth === expectedMinWidth &&
      finding.range?.maxWidth === expectedMaxWidth &&
      finding.source?.kind === 'css-declaration' &&
      finding.source?.confidence === 'deterministic' &&
      finding.source?.property === 'min-width' &&
      finding.source?.value === '800px',
  );

  assert(attributed, `preflight missing deterministic source attribution: ${JSON.stringify(preflight.findings)}`);
  assert(
    sourcePathMatchesStylesheet(attributed.source.stylesheet),
    `unexpected attributed stylesheet: ${attributed.source.stylesheet}`,
  );
  assert(
    attributed.source.media?.includes('min-width: 850px') &&
      attributed.source.media?.includes('max-width: 949px'),
    `unexpected media attribution: ${attributed.source.media}`,
  );

  compareHistory.length = 0;
  latestAllowedSources = new Map();

  let input = [
    {
      role: 'user',
      content:
        'Repair the real responsive regression. Use Viewportable V2 source attribution to inspect only the relevant local source context, make the smallest fix, and stop only after Viewportable reports clean.',
    },
  ];

  let completed = false;

  for (let round = 1; round <= maxRounds; round += 1) {
    const response = await createResponse(input);
    responseIds.push(response.id);
    usage.inputTokens += response.usage?.input_tokens ?? 0;
    usage.outputTokens += response.usage?.output_tokens ?? 0;
    usage.totalTokens += response.usage?.total_tokens ?? 0;

    const calls = (response.output ?? []).filter((item) => item.type === 'function_call');

    if (calls.length === 0) {
      finalOutput = finalText(response);
      const first = compareHistory[0];
      const last = compareHistory.at(-1);

      assert(first?.outcome === 'findings', 'agent never observed the regression');
      assert(
        toolHistory.some((entry) => entry.name === 'read_attributed_source_context'),
        'agent never used deterministic source attribution',
      );
      assert(writes >= 1, 'agent never edited styles.css');
      assert(last?.outcome === 'clean', 'agent stopped before Viewportable returned clean');
      assert((last?.summary?.findingCount ?? -1) === 0, 'final finding count is not zero');

      completed = true;
      break;
    }

    input = [...input, ...(response.output ?? [])];

    for (const call of calls) {
      const args = JSON.parse(call.arguments || '{}');
      const output = await runTool(call.name, args);
      input.push({
        type: 'function_call_output',
        call_id: call.call_id,
        output: JSON.stringify(output),
      });
    }
  }

  assert(completed, `agent did not finish within ${maxRounds} rounds`);

  const first = compareHistory[0];
  const last = compareHistory.at(-1);
  const finalStyles = await readFile(stylesPath, 'utf8');
  const sourceRestoredExactly = finalStyles === baselineStyles;
  assert(sourceRestoredExactly, 'agent did not restore styles.css exactly to baseline');
  assert(totalSourceContextBytes > 0, 'agent received no source context');
  assert(totalSourceContextBytes < 1_500, `source context was too large: ${totalSourceContextBytes}`);

  const acceptance = {
    version: 1,
    sourceRepository: 'viewportable/viewportable',
    sourceCommit: '7ce05528496e4ffae6f166387885bb325c35797f',
    model,
    schemaVersion: first.schemaVersion,
    result: 'pass',
    widths,
    responseIds,
    usage,
    toolCalls,
    writes,
    totalSourceContextBytes,
    previousFullStylesBytes: Buffer.byteLength(baselineStyles),
    toolHistory,
    initial: {
      findingCount: first.summary.findingCount,
      attributedFindingCount: (first.findings ?? []).filter((finding) => finding.source).length,
      findings: first.findings,
    },
    final: {
      findingCount: last.summary.findingCount,
      outcome: last.outcome,
    },
    sourceRestoredExactly,
    finalOutput,
  };

  await writeFile(
    '.slice/source-aware-react-agent-e2e-acceptance.json',
    `${JSON.stringify(acceptance, null, 2)}\n`,
  );

  process.stdout.write(
    [
      'OPENAI SOURCE-AWARE REAL REACT AGENT E2E PASS',
      'source: viewportable/viewportable@7ce05528496e',
      `schema: ${first.schemaVersion}`,
      `model: ${model}`,
      `initial findings: ${first.summary.findingCount}`,
      `attributed findings: ${(first.findings ?? []).filter((finding) => finding.source).length}`,
      `source context bytes: ${totalSourceContextBytes}`,
      `previous full styles bytes: ${Buffer.byteLength(baselineStyles)}`,
      `agent writes: ${writes}`,
      `tool calls: ${toolCalls}`,
      `final findings: ${last.summary.findingCount}`,
      `source restored exactly: ${sourceRestoredExactly}`,
      `tokens: ${usage.totalTokens}`,
      `final output: ${finalOutput}`,
      '',
    ].join('\n'),
  );
} finally {
  await mcpClient.close().catch(() => undefined);
  await Promise.all([stopProcess(baselineServer), stopProcess(candidateServer)]);
}
