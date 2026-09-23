import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createGitHubAppServer } from '../apps/github-app/src/server.mjs';
import { emptyState, MemoryStateStore } from '../apps/github-app/src/state.mjs';
import { handleWebhook } from '../apps/github-app/src/webhooks.mjs';

const root = path.resolve('.');
const retainedRoot = path.join(root, '.slice/github-app-v5-result-acceptance');
const acceptancePath = path.join(retainedRoot, 'acceptance.json');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

class FakeGitHub {
  constructor() {
    this.created = [];
    this.completed = [];
  }

  async createCheckRun(input) {
    this.created.push(input);
    return {
      id: 12345,
      html_url: 'https://github.com/acme/frontend/runs/12345',
    };
  }

  async completeCheckRun(input) {
    this.completed.push(input);
    return {
      id: input.checkRunId,
      html_url: 'https://github.com/acme/frontend/runs/12345',
    };
  }
}

const installation = {
  id: 7001,
  account: { id: 99, login: 'acme', type: 'Organization' },
  target_type: 'Organization',
  repository_selection: 'selected',
};

const repository = {
  id: 8801,
  full_name: 'acme/frontend',
  name: 'frontend',
  owner: { login: 'acme' },
  private: true,
  default_branch: 'main',
};

const pullRequest = {
  number: 42,
  base: { sha: 'base123' },
  head: { sha: 'head456', ref: 'feature/responsive' },
};

const reviewId = 'github:8801:pr:42:head:head456';
const resultToken = 'acceptance-result-token';
const store = new MemoryStateStore(emptyState());
const github = new FakeGitHub();

await rm(retainedRoot, { recursive: true, force: true });
await mkdir(retainedRoot, { recursive: true });

await handleWebhook({
  event: 'pull_request',
  deliveryId: 'acceptance-pr',
  payload: {
    action: 'opened',
    installation,
    repository,
    pull_request: pullRequest,
  },
  store,
  github,
  appBaseUrl: 'https://app.viewportable.dev',
});

assert(github.created.length === 1, 'expected one queued App-owned Check Run');

const server = await createGitHubAppServer({
  store,
  github,
  webhookSecret: 'acceptance-webhook-secret',
  resultToken,
  appBaseUrl: 'https://app.viewportable.dev',
});

await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});

const address = server.address();
if (!address || typeof address === 'string') throw new Error('GitHub App server did not bind');
const baseUrl = `http://127.0.0.1:${address.port}`;
const endpoint = `${baseUrl}/api/reviews/${encodeURIComponent(reviewId)}/result`;

const payload = {
  exitCode: 1,
  report: {
    findings: [
      {
        id: 'structural-disappearance',
        type: 'disappearance',
        direction: 'introduced',
        subject: { key: 'id:checkout-button' },
        sampledRange: { minWidth: 375, maxWidth: 430 },
        exactRange: { minWidth: 350, maxWidth: 499 },
      },
    ],
  },
  agentEvidence: {
    schemaVersion: 'viewportable.agent-evidence.v5',
    findings: [
      {
        id: 'structural-disappearance',
        repair: {
          repairable: false,
          reason: 'unsupported-finding',
        },
      },
    ],
  },
  detailsUrl: 'https://app.viewportable.dev/reviews/42',
  annotations: [
    {
      path: 'src/renderer/styles.css',
      start_line: 575,
      end_line: 575,
      start_column: 5,
      end_column: 22,
      annotation_level: 'notice',
      title: 'Viewportable: protrusion',
      message: '850-949px exact - responsive protrusion',
    },
  ],
};

try {
  const unauthorized = await fetch(endpoint, {
    method: 'POST',
    headers: {
      authorization: 'Bearer wrong-token',
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  assert(unauthorized.status === 401, `expected 401 for bad token, got ${unauthorized.status}`);
  assert(github.completed.length === 0, 'unauthorized result must not complete Check Run');

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${resultToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const result = await response.json();
  assert(response.status === 200, `expected 200 result submission, got ${response.status}`);
  assert(result.ok === true, 'expected ok=true result response');
  assert(result.conclusion === 'failure', `expected failure conclusion, got ${result.conclusion}`);
  assert(result.decision === 'block', `expected block decision, got ${result.decision}`);
  assert(github.completed.length === 1, 'expected exactly one completed Check Run');

  const completed = github.completed[0];
  assert(
    completed.summary.includes('Repair policy:** 0 auto-repairable · 1 manual review'),
    'App-owned Check is missing V5 repair-policy aggregate',
  );
  assert(
    completed.summary.includes('Manual review · unsupported-finding'),
    'App-owned Check is missing canonical manual-review reason',
  );
  assert(
    completed.summary.includes('350-499px exact'),
    'App-owned Check is missing structural range evidence',
  );

  const duplicateResponse = await fetch(endpoint, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${resultToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const duplicate = await duplicateResponse.json();
  assert(duplicateResponse.status === 200, 'duplicate result submission should remain successful');
  assert(duplicate.duplicate === true, 'duplicate result submission must be idempotent');
  assert(github.completed.length === 1, 'duplicate must not complete Check Run twice');

  const state = await store.read();
  const review = state.reviews[reviewId];
  assert(review?.status === 'completed', `expected completed review, got ${review?.status}`);
  assert(review?.decision === 'block', `expected block review decision, got ${review?.decision}`);

  const acceptance = {
    version: 1,
    transport: 'http',
    endpoint: '/api/reviews/:id/result',
    authentication: {
      invalidBearerRejected: true,
    },
    submitted: {
      exitCode: payload.exitCode,
      schemaVersion: payload.agentEvidence.schemaVersion,
      findingType: payload.report.findings[0].type,
      repair: payload.agentEvidence.findings[0].repair,
    },
    result: {
      status: response.status,
      conclusion: result.conclusion,
      decision: result.decision,
      duplicateIdempotent: duplicate.duplicate === true,
    },
    check: {
      completedCount: github.completed.length,
      title: completed.title,
      summaryContainsRepairPolicy: true,
      annotationCount: completed.annotations?.length ?? 0,
    },
  };

  await writeFile(acceptancePath, `${JSON.stringify(acceptance, null, 2)}\n`, 'utf8');

  process.stdout.write(
    [
      'GITHUB APP V5 RESULT ACCEPTANCE PASS',
      'transport: HTTP',
      'bad bearer: rejected',
      'agent evidence: viewportable.agent-evidence.v5',
      'repair: Manual review · unsupported-finding',
      'decision: block',
      'duplicate: idempotent',
      `acceptance: ${path.relative(root, acceptancePath)}`,
      '',
    ].join('\n'),
  );
} finally {
  await new Promise((resolve) => server.close(resolve));
}
