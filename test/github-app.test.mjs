import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { acceptReviewResult } from '../apps/github-app/src/results.mjs';
import { emptyState, MemoryStateStore } from '../apps/github-app/src/state.mjs';
import { handleWebhook, verifyWebhookSignature } from '../apps/github-app/src/webhooks.mjs';

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

describe('Viewportable GitHub App Installation V1', () => {
  it('verifies GitHub webhook HMAC-SHA256 signatures', () => {
    const body = Buffer.from('{"ok":true}');
    const secret = 'test-secret';
    const signature = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

    expect(verifyWebhookSignature(body, signature, secret)).toBe(true);
    expect(verifyWebhookSignature(body, 'sha256=deadbeef', secret)).toBe(false);
    expect(verifyWebhookSignature(body, null, secret)).toBe(false);
  });

  it('maps installation repositories to deterministic Viewportable projects', async () => {
    const store = new MemoryStateStore(emptyState());
    const github = new FakeGitHub();

    await handleWebhook({
      event: 'installation',
      deliveryId: 'delivery-install',
      payload: {
        action: 'created',
        installation,
        repositories: [repository],
      },
      store,
      github,
    });

    const state = await store.read();
    expect(state.installations['7001']).toMatchObject({
      id: 7001,
      accountLogin: 'acme',
      repositorySelection: 'selected',
    });
    expect(state.repositories['8801']).toMatchObject({
      installationId: 7001,
      fullName: 'acme/frontend',
    });
    expect(state.projects['github:7001:8801']).toEqual({
      id: 'github:7001:8801',
      installationId: 7001,
      repositoryId: 8801,
      repositoryFullName: 'acme/frontend',
      status: 'active',
    });
  });

  it('queues one review and one Check Run for an idempotent pull_request delivery', async () => {
    const store = new MemoryStateStore(emptyState());
    const github = new FakeGitHub();
    const input = {
      event: 'pull_request',
      deliveryId: 'delivery-pr-1',
      payload: {
        action: 'synchronize',
        installation,
        repository,
        pull_request: pullRequest,
      },
      store,
      github,
      appBaseUrl: 'https://app.viewportable.dev',
    };

    const first = await handleWebhook(input);
    const duplicate = await handleWebhook(input);
    const state = await store.read();
    const review = state.reviews['github:8801:pr:42:head:head456'];

    expect(first).toMatchObject({
      reviewId: 'github:8801:pr:42:head:head456',
      projectId: 'github:7001:8801',
      checkRunId: 12345,
    });
    expect(duplicate).toEqual({ ok: true, duplicate: true });
    expect(github.created).toHaveLength(1);
    expect(github.created[0]).toMatchObject({
      installationId: 7001,
      repositoryFullName: 'acme/frontend',
      headSha: 'head456',
      externalId: 'github:8801:pr:42:head:head456',
    });
    expect(review).toMatchObject({
      projectId: 'github:7001:8801',
      baseSha: 'base123',
      headSha: 'head456',
      status: 'queued',
      checkRunId: 12345,
    });
  });

  it('completes the App-owned Check Run from canonical Engine evidence', async () => {
    const store = new MemoryStateStore(emptyState());
    const github = new FakeGitHub();

    await handleWebhook({
      event: 'pull_request',
      deliveryId: 'delivery-pr-2',
      payload: {
        action: 'opened',
        installation,
        repository,
        pull_request: pullRequest,
      },
      store,
      github,
    });

    const result = await acceptReviewResult({
      reviewId: 'github:8801:pr:42:head:head456',
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
        {
          path: '../outside.css',
          start_line: 1,
          end_line: 1,
          message: 'must be rejected',
        },
      ],
      store,
      github,
    });

    expect(result).toMatchObject({
      conclusion: 'failure',
      decision: 'block',
    });
    expect(github.completed).toHaveLength(1);
    expect(github.completed[0]).toMatchObject({
      installationId: 7001,
      repositoryFullName: 'acme/frontend',
      checkRunId: 12345,
      conclusion: 'failure',
      title: '1 structural regression introduced',
      annotations: [
        {
          path: 'src/renderer/styles.css',
          start_line: 575,
          end_line: 575,
          start_column: 5,
          end_column: 22,
          annotation_level: 'failure',
          title: 'Viewportable: protrusion',
          message: '850-949px exact - responsive protrusion',
        },
      ],
    });
    expect(github.completed[0].summary).toContain('350-499px exact');
    expect(github.completed[0].summary).toContain('id:checkout-button disappeared');
    expect(github.completed[0].summary).toContain(
      'Repair policy:** 0 auto-repairable · 1 manual review',
    );
    expect(github.completed[0].summary).toContain('Manual review · unsupported-finding');

    const duplicate = await acceptReviewResult({
      reviewId: 'github:8801:pr:42:head:head456',
      exitCode: 1,
      report: { findings: [] },
      annotations: [
        {
          path: 'src/renderer/styles.css',
          start_line: 575,
          end_line: 575,
          message: 'must not be appended twice',
        },
      ],
      store,
      github,
    });

    expect(duplicate).toMatchObject({
      conclusion: 'failure',
      decision: 'block',
      duplicate: true,
    });
    expect(github.completed).toHaveLength(1);

    const state = await store.read();
    expect(state.reviews['github:8801:pr:42:head:head456']).toMatchObject({
      status: 'completed',
      decision: 'block',
      detailsUrl: 'https://app.viewportable.dev/reviews/42',
    });
  });

  it('removes projects when installation repository access is removed', async () => {
    const store = new MemoryStateStore(emptyState());
    const github = new FakeGitHub();

    await handleWebhook({
      event: 'installation',
      deliveryId: 'delivery-install-2',
      payload: { action: 'created', installation, repositories: [repository] },
      store,
      github,
    });

    await handleWebhook({
      event: 'installation_repositories',
      deliveryId: 'delivery-repo-remove',
      payload: {
        action: 'removed',
        installation,
        repositories_added: [],
        repositories_removed: [repository],
      },
      store,
      github,
    });

    const state = await store.read();
    expect(state.repositories['8801']).toBeUndefined();
    expect(state.projects['github:7001:8801']).toBeUndefined();
  });
});
