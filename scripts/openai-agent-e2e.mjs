import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) throw new Error('OPENAI_API_KEY is required');

const model = process.env.OPENAI_MODEL ?? 'gpt-5.6-terra';
const widths = [320, 375, 430, 520];
const maxRounds = 8;
const maxToolCalls = 12;
const maxWrites = 3;

const root = resolve('.slice/openai-agent-e2e');
const evidenceRoot = resolve(root, 'evidence');
const candidatePath = resolve(root, 'candidate.html');
const acceptancePath = resolve(root, 'acceptance.json');

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
    'Candidate includes compact-layout behavior for actions.',
  );

  return changed.replace(
    '  </body>',
    `    <script>
      const pageRoot = document.querySelector('#page-root');
      const pricingCard = document.querySelector('#pricing-card');
      const cta = document.querySelector('#cta');
      const checkoutButton = document.querySelector('#checkout-button');

      function syncCompactActions() {
        const compactBand = window.innerWidth >= 350 && window.innerWidth <= 499;

        (compactBand ? pageRoot : pricingCard).appendChild(cta);
        checkoutButton.style.display = compactBand ? 'none' : 'block';
      }

      syncCompactActions();
      window.addEventListener('resize', syncCompactActions);
    </script>
  </body>`,
  );
}

const tools = [
  {
    type: 'function',
    name: 'viewportable_compare',
    description:
      'Run Viewportable structural baseline-vs-candidate comparison. Call this first, and call it again after every candidate edit. A clean outcome means the regression is fixed.',
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
    name: 'read_candidate',
    description:
      'Read the complete candidate HTML file that you are allowed to modify. This is the only file you can inspect.',
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
    name: 'write_candidate',
    description:
      'Replace the complete candidate HTML file. Make the smallest change that fixes the Viewportable findings while preserving the page content and intended stable layout.',
    parameters: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'Complete replacement HTML document.',
        },
      },
      required: ['content'],
      additionalProperties: false,
    },
    strict: true,
  },
];

const instructions = [
  'You are a coding agent in a constrained acceptance test.',
  'Your goal is to fix the candidate HTML until Viewportable reports outcome clean.',
  'Your FIRST tool call must be viewportable_compare.',
  'Use read_candidate to inspect the candidate only after you have seen Viewportable evidence.',
  'Use write_candidate only when you have a concrete fix.',
  'After every write_candidate call, call viewportable_compare again.',
  'Make the smallest reasonable change. Preserve the visible page content and stable responsive structure.',
  'Do not stop merely because you believe the code is fixed. Stop only after viewportable_compare returns outcome clean.',
  'You have no shell, no GitHub access, no environment access, and no network tools beyond the functions provided.',
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

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`OpenAI Responses API failed with HTTP ${response.status}: ${text.slice(0, 2000)}`);
  }

  return JSON.parse(text);
}

function finalText(response) {
  const parts = [];
  for (const item of response.output ?? []) {
    if (item.type !== 'message') continue;
    for (const content of item.content ?? []) {
      if (content.type === 'output_text' && typeof content.text === 'string') {
        parts.push(content.text);
      }
    }
  }
  return parts.join('\n').trim();
}

await rm(root, { recursive: true, force: true });
await mkdir(evidenceRoot, { recursive: true });

const baselineHtml = await readFile('examples/golden-pr/app/index.html', 'utf8');
const initialCandidate = brokenCandidate(baselineHtml);
await writeFile(candidatePath, initialCandidate, 'utf8');

const baselineFixture = await serve(() => baselineHtml);
const candidateFixture = await serve(() => readFileSync(candidatePath, 'utf8'));

const mcpTransport = new StdioClientTransport({
  command: process.execPath,
  args: [resolve('dist/mcp.mjs')],
});
const mcpClient = new Client({
  name: 'viewportable-openai-agent-e2e',
  version: '1.0.0',
});

const toolHistory = [];
const compareHistory = [];
const responseIds = [];
const usage = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
};
let toolCalls = 0;
let writes = 0;
let finalOutput = '';

async function runTool(name, args) {
  toolCalls += 1;
  assert(toolCalls <= maxToolCalls, `tool-call limit exceeded: ${toolCalls}`);

  if (toolHistory.length === 0) {
    assert(name === 'viewportable_compare', `first tool must be viewportable_compare, got ${name}`);
  }

  if (name === 'viewportable_compare') {
    const result = await mcpClient.callTool(
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

    assert(result.isError !== true, 'Viewportable MCP returned a tool error');
    assert(
      result.structuredContent && typeof result.structuredContent === 'object',
      'Viewportable MCP result is missing structuredContent',
    );

    const structured = result.structuredContent;
    const findings = Array.isArray(structured.findings) ? structured.findings : [];
    const compact = {
      outcome: structured.outcome,
      exitCode: structured.exitCode,
      summary: structured.summary ?? null,
      findings,
    };

    compareHistory.push({
      ...compact,
      reportPath: structured.reportPath,
    });
    toolHistory.push({
      name,
      outcome: structured.outcome,
      findingCount: findings.length,
    });

    return compact;
  }

  if (name === 'read_candidate') {
    const content = await readFile(candidatePath, 'utf8');
    toolHistory.push({ name, bytes: Buffer.byteLength(content) });
    return { content };
  }

  if (name === 'write_candidate') {
    writes += 1;
    assert(writes <= maxWrites, `write limit exceeded: ${writes}`);
    assert(typeof args.content === 'string', 'write_candidate.content must be a string');
    assert(args.content.length >= 100, 'candidate replacement is unexpectedly small');
    assert(args.content.length <= 20_000, 'candidate replacement is unexpectedly large');
    assert(/<!doctype html>/i.test(args.content), 'candidate must remain a complete HTML document');
    assert(args.content.includes('id="page-root"'), 'candidate must preserve #page-root');
    assert(args.content.includes('id="pricing-card"'), 'candidate must preserve #pricing-card');
    assert(args.content.includes('id="cta"'), 'candidate must preserve #cta');
    assert(args.content.includes('id="checkout-button"'), 'candidate must preserve #checkout-button');

    await writeFile(candidatePath, args.content, 'utf8');
    toolHistory.push({
      name,
      bytes: Buffer.byteLength(args.content),
    });
    return { ok: true, bytes: Buffer.byteLength(args.content) };
  }

  throw new Error(`unknown tool: ${name}`);
}

try {
  await mcpClient.connect(mcpTransport);

  const listed = await mcpClient.listTools();
  const mcpToolNames = listed.tools.map((tool) => tool.name);
  assert(mcpToolNames.includes('viewportable_compare'), 'MCP server does not expose viewportable_compare');

  let input = [
    {
      role: 'user',
      content:
        'Fix the responsive structural regression in the candidate. Use Viewportable as the independent verifier. Do not claim success until Viewportable reports clean.',
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
      const firstCompare = compareHistory[0];
      const lastCompare = compareHistory.at(-1);

      assert(firstCompare?.outcome === 'findings', 'agent never observed the broken Viewportable result');
      assert((firstCompare?.findings?.length ?? 0) === 2, 'initial compare did not expose exactly 2 findings');
      assert(writes >= 1, 'agent never edited the candidate');
      assert(lastCompare?.outcome === 'clean', 'agent stopped before Viewportable returned clean');
      assert((lastCompare?.findings?.length ?? 0) === 0, 'final compare still contains findings');

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

  assert(completed, `agent did not complete within ${maxRounds} model rounds`);

  const firstCompare = compareHistory[0];
  const finalCompare = compareHistory.at(-1);
  const firstTypes = firstCompare.findings.map((finding) => finding.type).sort();

  assert(
    JSON.stringify(firstTypes) === JSON.stringify(['disappearance', 'reparenting']),
    `unexpected initial finding types: ${JSON.stringify(firstTypes)}`,
  );
  assert(
    firstCompare.findings.every(
      (finding) =>
        finding.exactRange?.minWidth === 350 && finding.exactRange?.maxWidth === 499,
    ),
    'initial findings are not both exact 350-499px',
  );

  const finalCandidate = await readFile(candidatePath, 'utf8');
  assert(finalCandidate !== initialCandidate, 'candidate content did not change');

  const acceptance = {
    version: 1,
    model,
    store: false,
    widths,
    result: 'pass',
    responseIds,
    usage,
    toolCalls,
    writes,
    toolHistory,
    initial: {
      outcome: firstCompare.outcome,
      findingTypes: firstTypes,
      exactRange: { minWidth: 350, maxWidth: 499 },
      reportPath: firstCompare.reportPath,
    },
    final: {
      outcome: finalCompare.outcome,
      findingCount: finalCompare.findings.length,
      reportPath: finalCompare.reportPath,
    },
    finalOutput,
    candidatePath,
  };

  await writeFile(acceptancePath, `${JSON.stringify(acceptance, null, 2)}\n`, 'utf8');

  process.stdout.write(
    [
      'OPENAI AGENT E2E PASS',
      `model: ${model}`,
      'initial: 2 findings @ 350-499px exact (disappearance, reparenting)',
      `agent writes: ${writes}`,
      `tool calls: ${toolCalls}`,
      'final: 0 findings',
      `tokens: ${usage.totalTokens}`,
      `acceptance: ${acceptancePath}`,
      '',
    ].join('\n'),
  );
} finally {
  await mcpClient.close().catch(() => undefined);
  await Promise.all([
    new Promise((resolveClose) => baselineFixture.server.close(resolveClose)),
    new Promise((resolveClose) => candidateFixture.server.close(resolveClose)),
  ]);
}
