export function projectId(installationId, repositoryId) {
  return `github:${installationId}:${repositoryId}`;
}

export function reviewId(repositoryId, pullRequestNumber, headSha) {
  return `github:${repositoryId}:pr:${pullRequestNumber}:head:${headSha}`;
}

function repositoryRecord(installationId, repository) {
  return {
    id: repository.id,
    installationId,
    fullName: repository.full_name,
    owner: repository.owner?.login ?? repository.full_name?.split('/')[0] ?? null,
    name: repository.name ?? repository.full_name?.split('/')[1] ?? null,
    private: Boolean(repository.private),
    defaultBranch: repository.default_branch ?? null,
  };
}

export function upsertInstallation(state, installation, repositories = []) {
  const id = installation.id;
  state.installations[id] = {
    id,
    accountId: installation.account?.id ?? null,
    accountLogin: installation.account?.login ?? null,
    accountType: installation.account?.type ?? null,
    targetType: installation.target_type ?? null,
    repositorySelection: installation.repository_selection ?? null,
    suspendedAt: installation.suspended_at ?? null,
  };

  for (const repository of repositories) {
    upsertRepository(state, id, repository);
  }

  return state.installations[id];
}

export function removeInstallation(state, installationId) {
  delete state.installations[installationId];

  for (const repository of Object.values(state.repositories)) {
    if (repository.installationId === installationId) {
      removeRepository(state, repository.id);
    }
  }
}

export function upsertRepository(state, installationId, repository) {
  const record = repositoryRecord(installationId, repository);
  state.repositories[record.id] = record;

  const id = projectId(installationId, record.id);
  state.projects[id] = {
    id,
    installationId,
    repositoryId: record.id,
    repositoryFullName: record.fullName,
    status: 'active',
  };

  return state.projects[id];
}

export function removeRepository(state, repositoryId) {
  const repository = state.repositories[repositoryId];
  if (!repository) return;

  delete state.repositories[repositoryId];
  delete state.projects[projectId(repository.installationId, repositoryId)];

  for (const [id, review] of Object.entries(state.reviews)) {
    if (review.repositoryId === repositoryId) delete state.reviews[id];
  }
}

export function upsertPullRequestReview(state, {
  installationId,
  repository,
  pullRequest,
  detailsUrl = null,
}) {
  const project = upsertRepository(state, installationId, repository);
  const headSha = pullRequest.head.sha;
  const id = reviewId(repository.id, pullRequest.number, headSha);
  const existing = state.reviews[id];

  state.reviews[id] = {
    id,
    projectId: project.id,
    installationId,
    repositoryId: repository.id,
    repositoryFullName: repository.full_name,
    pullRequestNumber: pullRequest.number,
    baseSha: pullRequest.base.sha,
    headSha,
    headRef: pullRequest.head.ref ?? null,
    status: existing?.status ?? 'queued',
    decision: existing?.decision ?? null,
    checkRunId: existing?.checkRunId ?? null,
    checkUrl: existing?.checkUrl ?? null,
    detailsUrl,
  };

  return state.reviews[id];
}

export function recordDelivery(state, deliveryId, event, action) {
  state.deliveries[deliveryId] = {
    id: deliveryId,
    event,
    action: action ?? null,
    receivedAt: new Date().toISOString(),
  };

  const entries = Object.keys(state.deliveries);
  if (entries.length > 500) {
    for (const id of entries.slice(0, entries.length - 500)) delete state.deliveries[id];
  }
}
