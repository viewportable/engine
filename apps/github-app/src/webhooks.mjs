import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  recordDelivery,
  removeInstallation,
  removeRepository,
  upsertInstallation,
  upsertPullRequestReview,
  upsertRepository,
} from './model.mjs';

const REVIEW_ACTIONS = new Set(['opened', 'reopened', 'synchronize', 'ready_for_review']);

export function verifyWebhookSignature(rawBody, signature, secret) {
  if (!signature?.startsWith('sha256=')) return false;
  const expected = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(actualBuffer, expectedBuffer);
}

export async function handleWebhook({
  event,
  deliveryId,
  payload,
  store,
  github,
  appBaseUrl = null,
}) {
  const state = await store.read();
  if (state.deliveries[deliveryId]) {
    return { ok: true, duplicate: true };
  }

  if (event === 'installation') {
    await store.transact((next) => {
      if (payload.action === 'deleted') {
        removeInstallation(next, payload.installation.id);
      } else {
        upsertInstallation(next, payload.installation, payload.repositories ?? []);
      }
      recordDelivery(next, deliveryId, event, payload.action);
    });
    return { ok: true, event, action: payload.action };
  }

  if (event === 'installation_repositories') {
    await store.transact((next) => {
      upsertInstallation(next, payload.installation);
      for (const repository of payload.repositories_added ?? []) {
        upsertRepository(next, payload.installation.id, repository);
      }
      for (const repository of payload.repositories_removed ?? []) {
        removeRepository(next, repository.id);
      }
      recordDelivery(next, deliveryId, event, payload.action);
    });
    return { ok: true, event, action: payload.action };
  }

  if (event === 'pull_request' && REVIEW_ACTIONS.has(payload.action)) {
    const detailsUrl = appBaseUrl
      ? `${appBaseUrl.replace(/\/$/, '')}/projects/github:${payload.installation.id}:${payload.repository.id}/pulls/${payload.pull_request.number}`
      : null;

    const review = await store.transact((next) => {
      upsertInstallation(next, payload.installation, [payload.repository]);
      return upsertPullRequestReview(next, {
        installationId: payload.installation.id,
        repository: payload.repository,
        pullRequest: payload.pull_request,
        detailsUrl,
      });
    });

    let check = null;
    if (review.checkRunId) {
      check = {
        id: review.checkRunId,
        html_url: review.checkUrl,
      };
    } else {
      check = await github.createCheckRun({
        installationId: review.installationId,
        repositoryFullName: review.repositoryFullName,
        headSha: review.headSha,
        externalId: review.id,
        detailsUrl: review.detailsUrl,
      });
    }

    await store.transact((next) => {
      const current = next.reviews[review.id];
      current.checkRunId = check.id;
      current.checkUrl = check.html_url ?? current.checkUrl;
      current.status = 'queued';
      recordDelivery(next, deliveryId, event, payload.action);
    });

    return {
      ok: true,
      event,
      action: payload.action,
      reviewId: review.id,
      projectId: review.projectId,
      checkRunId: check.id,
    };
  }

  await store.transact((next) => {
    recordDelivery(next, deliveryId, event, payload.action);
  });
  return { ok: true, ignored: true, event, action: payload.action ?? null };
}
