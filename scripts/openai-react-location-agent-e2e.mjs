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
const maxToolCalls = 16;
const maxWrites = 3;

const sourceFiles = [
  'src/renderer/styles.css',
  'src/renderer/App.tsx',
  'src/renderer/components/ViewportCard.tsx',
];

const regression = `

@media (min-width: 850px) and (max-width: 949px) {
  [data-viewport-id="iphone-15-pro"] {
    min-width: 1400px;
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
  assert(index.includes('<script type="module" src="/main.tsx"></script>'), 'renderer index marker missing');
  await writeFile(
    indexPath,
    index.replace('<script type="module" src="/main.tsx"></script>', `${bridge}    <script type="module" src="/main.tsx"></script>`),
    'utf8',
  );
  await writeFile(resolve(root, 'agent-vite.config.mjs'), viteConfig, 'utf8');
}

async function appendRegression() {
  const stylesPath = resolve(candidateRoot, 'src/renderer/styles.css');
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
      // Server is still starting.
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


function attributedFinding(evidence) {
  const findings = Array.isArray(evidence?.findings) ? evidence.findings : [];
  return findings.find(
    (finding) =>
      finding.type === 'protrusion' &&
      finding.direction === 'introduced' &&
      finding.subject?.identity === 'data-testid:viewport-scroll-zone-iphone-15-pro' &&
      finding.source?.kind === 'css-declaration' &&
      finding.source?.confidence === 'deterministic',
  );
}

function candidateStylesPathFromSource(source) {
  const stylesheet = source?.stylesheet;
  assert(typeof stylesheet === 'string', 'attributed stylesheet path is missing');
  assert(
    stylesheet.includes('src/renderer/styles.css'),
    'unexpected attributed stylesheet: ' + stylesheet,
  );
  return resolve(candidateRoot, 'src/renderer/styles.css');
}

function sourceLocationContext(content, source, radius = 2) {
  const location = source?.location;
  assert(location?.kind === 'css-property-range', 'missing css-property-range location');
  assert(location?.confidence === 'deterministic', 'source location is not deterministic');
  assert(location?.coordinateSpace === 'stylesheet', 'unexpected source coordinate space');
  assert(Number.isInteger(location.start?.line), 'source location start line is missing');
  assert(Number.isInteger(location.start?.column), 'source location start column is missing');
  assert(Number.isInteger(location.end?.line), 'source location end line is missing');
  assert(Number.isInteger(location.end?.column), 'source location end column is missing');

  const lines = content.split('\n');
  const declarationLine = lines[location.start.line - 1];
  assert(typeof declarationLine === 'string', 'source location line is outside styles.css');

  const declarationText = declarationLine.slice(
    location.start.column - 1,
    location.end.column - 1,
  );
  assert(
    declarationText.includes(source.property) && declarationText.includes(source.value),
    'source location does not point at the attributed declaration: ' + declarationText,
  );

  const startLine = Math.max(1, location.start.line - radius);
  const endLine = Math.min(lines.length, location.end.line + radius);
  const context = lines.slice(startLine - 1, endLine).join('\n');

  return {
    startLine,
    endLine,
    declarationText,
    content: context,
  };
}

function attributedSnippet(content, source) {
  const expected =
    '@media ' +
    source.media +
    ' {\n  ' +
    source.selector +
    ' {\n    ' +
    source.property +
    ': ' +
    source.value +
    ';\n  }\n}';
  assert(content.includes(expected), 'could not extract attributed CSS block from source file');
  return expected;
}

function validateAttributedRegression(evidence) {
  const finding = attributedFinding(evidence);
  assert(finding, 'missing deterministic attributed protrusion: ' + JSON.stringify(evidence?.findings));
  assert(
    finding.range?.kind === 'exact' &&
      finding.range?.minWidth === expectedMinWidth &&
      finding.range?.maxWidth === expectedMaxWidth,
    'unexpected attributed range: ' + JSON.stringify(finding.range),
  );
  assert(finding.source.selector === '[data-viewport-id="iphone-15-pro"]', 'wrong source selector');
  assert(finding.source.property === 'min-width', 'wrong source property');
  assert(finding.source.value === '1400px', 'wrong source value');
  assert(
    finding.source.media === '(min-width: 850px) and (max-width: 949px)',
    'wrong media attribution: ' + finding.source.media,
  );
  const stylesPath = candidateStylesPathFromSource(finding.source);
  assert(finding.source.location !== null, 'source location is null');
  return { finding, stylesPath };
}

const tools = [
  {
    type: 'function',
    name: 'viewportable_compare',
    description:
      'Run Viewportable Canonical Agent Evidence V3 against the real baseline and candidate React renderer. Call this first and after every source edit. Success requires outcome clean.',
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
    name: 'read_attributed_range',
    description:
      'Read only a narrow source context around the deterministic source.location range returned by Viewportable. A full-file source read is intentionally unavailable.',
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
    name: 'replace_in_attributed_range',
    description:
      'Apply one exact minimal replacement inside the narrow source context identified by Viewportable source.location.',
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
          description: 'Replacement text. May be empty when removing an erroneous block.',
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
  'The baseline and candidate started from the same real repository commit. A controlled responsive regression was then introduced into the candidate source.',
  'Your goal is to make Viewportable report outcome clean while preserving the existing product UI.',
  'Your FIRST tool call must be viewportable_compare.',
  'Use finding.source.location from Viewportable Canonical Agent Evidence V3 as the source of truth for where to inspect.',
  'There is deliberately no generic full-file source read tool.',
  'Use read_attributed_range to inspect only a few lines around the browser-proven declaration range.',
  'You may modify only text inside that attributed range context through replace_in_attributed_range.',
  'Make the smallest exact source replacement that fixes the regression. Never rewrite or reformat the whole file.',
  'Do not leave empty CSS rules or empty media blocks. If the attributed declaration is the only declaration in an introduced rule, remove the complete redundant rule/media block.',
  'After every replace_in_attributed_range call, call viewportable_compare again.',
  'Do not stop based on code inspection alone. Stop only after Viewportable returns outcome clean.',
  'Do not rewrite unrelated styling.',
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
      max_output_tokens: 3500,
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

await prepareRenderer(baselineRoot);
await prepareRenderer(candidateRoot);
const baselineStyles = await readFile(resolve(baselineRoot, 'src/renderer/styles.css'), 'utf8');
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
  name: 'viewportable-real-react-agent-e2e',
  version: '1.0.0',
});

const toolHistory = [];
const compareHistory = [];
const responseIds = [];
const usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
let toolCalls = 0;
let writes = 0;
let attributedBytesRead = 0;
let latestEvidence = null;
let latestRangeContext = null;
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
        waitMs: 1_000,
        timeoutMs: 30_000,
        boundary: true,
        readySelector: '[data-testid="device-card-iphone-15-pro"]',
        outBase: '.slice/openai-react-agent-e2e',
      },
    },
    { timeout: 120_000 },
  );

  if (result.isError === true) {
    throw new Error(
      `Viewportable MCP returned isError: ${JSON.stringify(
        result.structuredContent ?? result.content,
      )}`,
    );
  }
  const evidence = result.structuredContent;
  assert(evidence && typeof evidence === 'object', 'missing Viewportable structuredContent');
  assert(
    evidence.schemaVersion === 'viewportable.agent-evidence.v3',
    `unexpected evidence schema: ${evidence.schemaVersion}`,
  );

  latestEvidence = evidence;
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
      findingTypes: Array.isArray(evidence.findings)
        ? evidence.findings.map((finding) => finding.type)
        : [],
    });
    return evidence;
  }

  if (name === 'read_attributed_range') {
    const { finding, stylesPath } = validateAttributedRegression(latestEvidence);
    const content = await readFile(stylesPath, 'utf8');
    const context = sourceLocationContext(content, finding.source);
    const bytes = Buffer.byteLength(context.content);
    attributedBytesRead += bytes;
    latestRangeContext = context;
    toolHistory.push({
      name,
      stylesheet: finding.source.stylesheet,
      selector: finding.source.selector,
      property: finding.source.property,
      value: finding.source.value,
      media: finding.source.media,
      location: finding.source.location,
      contextStartLine: context.startLine,
      contextEndLine: context.endLine,
      bytes,
    });
    return {
      source: finding.source,
      startLine: context.startLine,
      endLine: context.endLine,
      content: context.content,
    };
  }

  if (name === 'replace_in_attributed_range') {
    writes += 1;
    assert(writes <= maxWrites, `write limit exceeded: ${writes}`);
    assert(typeof args.oldText === 'string' && args.oldText.length > 0, 'oldText is required');
    assert(typeof args.newText === 'string', 'newText must be a string');
    assert(latestRangeContext, 'read_attributed_range must be called before editing');

    const { finding, stylesPath } = validateAttributedRegression(latestEvidence);
    const current = await readFile(stylesPath, 'utf8');
    sourceLocationContext(current, finding.source);
    assert(
      latestRangeContext.content.includes(args.oldText),
      'replacement oldText is outside the attributed source-location context',
    );
    const occurrences = current.split(args.oldText).length - 1;
    assert(
      occurrences === 1,
      `oldText must occur exactly once in styles.css; found ${occurrences}`,
    );

    const next = current.replace(args.oldText, args.newText);
    const emptyAttributedRule = finding.source.selector + ' {\n  }';
    if (next.includes(emptyAttributedRule)) {
      toolHistory.push({
        name,
        accepted: false,
        reason: 'replacement would leave an empty attributed CSS rule',
      });
      return {
        ok: false,
        error:
          'This patch would leave the attributed CSS rule empty. Remove the complete redundant rule/media block instead.',
      };
    }

    const normalized = `${next.trimEnd()}\n`;
    await writeFile(stylesPath, normalized, 'utf8');
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
    toolHistory.push({
      name,
      accepted: true,
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
  await Promise.all([
    waitFor(baselineUrl, baselineServer),
    waitFor(candidateUrl, candidateServer),
  ]);
  // Let Vite finish cold dependency optimization before the browser readiness gate.
  await new Promise((resolveWait) => setTimeout(resolveWait, 5_000));
  await mcpClient.connect(mcpTransport);

  const preflight = await runCompare();
  assert(preflight.outcome === 'findings', `preflight expected findings, got ${preflight.outcome}`);
  const preflightAttributed = validateAttributedRegression(preflight);
  const preflightStyles = await readFile(preflightAttributed.stylesPath, 'utf8');
  const preflightLocationContext = sourceLocationContext(
    preflightStyles,
    preflightAttributed.finding.source,
    0,
  );
  assert(
    preflightLocationContext.declarationText.includes('min-width') &&
      preflightLocationContext.declarationText.includes('1400px'),
    'V3 source location does not map to the real React source declaration',
  );

  compareHistory.length = 0;
  latestEvidence = null;
  latestRangeContext = null;

  let input = [
    {
      role: 'user',
      content:
        'Repair the responsive structural regression in this real Viewportable React renderer. Use Viewportable evidence as the verifier and stop only when it reports clean.',
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

      assert(first?.outcome === 'findings', 'agent never observed the broken React UI');
      validateAttributedRegression(first);
      assert(writes >= 1, 'agent never edited the attributed CSS');
      assert(attributedBytesRead > 0, 'agent never read attributed CSS');
      assert(
        attributedBytesRead < 256,
        `attributed source read was unexpectedly large: ${attributedBytesRead}`,
      );
      assert(last?.outcome === 'clean', 'agent stopped before Viewportable returned clean');
      assert((last?.summary?.findingCount ?? -1) === 0, 'final canonical finding count is not zero');

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
  const finalStyles = await readFile(resolve(candidateRoot, 'src/renderer/styles.css'), 'utf8');
  const sourceRestoredExactly = finalStyles === baselineStyles;
  assert(
    sourceRestoredExactly,
    'agent reached clean layout but did not restore the baseline source exactly',
  );

  const acceptance = {
    version: 3,
    sourceRepository: 'viewportable/viewportable',
    sourceCommit: '7ce05528496e4ffae6f166387885bb325c35797f',
    engineCommit: '031248014d9779f6b4750e061db9eea42e2e297b',
    model,
    schemaVersion: first.schemaVersion,
    result: 'pass',
    widths,
    expectedExactRange: { minWidth: expectedMinWidth, maxWidth: expectedMaxWidth },
    preflightSource: preflightAttributed.finding.source,
    preflightLocationContext,
    responseIds,
    usage,
    toolCalls,
    writes,
    attributedBytesRead,
    fullSourceReadAvailable: false,
    toolHistory,
    initial: {
      outcome: first.outcome,
      findingCount: first.summary.findingCount,
      findings: first.findings,
      reportPath: first.evidence.reportPath,
    },
    final: {
      outcome: last.outcome,
      findingCount: last.summary.findingCount,
      reportPath: last.evidence.reportPath,
    },
    sourceRestoredExactly,
    finalOutput,
  };

  await writeFile('.slice/openai-react-agent-e2e-acceptance.json', `${JSON.stringify(acceptance, null, 2)}\n`);

  process.stdout.write(
    [
      'OPENAI REAL REACT SOURCE LOCATION E2E PASS',
      'source: viewportable/viewportable@7ce05528496e',
      `schema: ${first.schemaVersion}`,
      `model: ${model}`,
      `initial findings: ${first.summary.findingCount}`,
      `source-location bytes read: ${attributedBytesRead}`,
      'full source read available: false',
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
  await Promise.all([
    stopProcess(baselineServer),
    stopProcess(candidateServer),
  ]);
}
