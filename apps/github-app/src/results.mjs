import { normalizeSubmittedAnnotations } from '../../../scripts/github-annotations.mjs';
import { renderResult } from './evidence.mjs';

export async function acceptReviewResult({
  reviewId,
  exitCode,
  report,
  detailsUrl = null,
  annotations = [],
  store,
  github,
}) {
  const state = await store.read();
  const review = state.reviews[reviewId];
  if (!review) throw new Error(`unknown review: ${reviewId}`);
  if (!review.checkRunId) throw new Error(`review has no Check Run: ${reviewId}`);

  const rendered = renderResult(report, exitCode);
  const sourceAnnotations = normalizeSubmittedAnnotations(annotations);
  const check = await github.completeCheckRun({
    installationId: review.installationId,
    repositoryFullName: review.repositoryFullName,
    checkRunId: review.checkRunId,
    conclusion: rendered.conclusion,
    title: rendered.title,
    summary: rendered.summary,
    annotations: sourceAnnotations,
    detailsUrl: detailsUrl ?? review.detailsUrl,
  });

  await store.transact((next) => {
    const current = next.reviews[reviewId];
    current.status = 'completed';
    current.decision =
      rendered.conclusion === 'success'
        ? 'allow'
        : rendered.conclusion === 'failure'
          ? 'block'
          : 'infra_failure';
    current.checkUrl = check?.html_url ?? current.checkUrl;
    if (detailsUrl) current.detailsUrl = detailsUrl;
  });

  return {
    reviewId,
    conclusion: rendered.conclusion,
    decision:
      rendered.conclusion === 'success'
        ? 'allow'
        : rendered.conclusion === 'failure'
          ? 'block'
          : 'infra_failure',
    checkUrl: check?.html_url ?? review.checkUrl,
  };
}
