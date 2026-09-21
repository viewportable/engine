import { appendFile, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const PR_COMMENT_MARKER = '<!-- viewportable-engine-pr-evidence-v1 -->';

function markdownCell(value) {
  return String(value ?? '')
    .replaceAll('|', '\\|')
    .replace(/[\r\n]+/g, ' ')
    .trim();
}

function shortSha(value) {
  return value ? value.slice(0, 12) : null;
}

function sampledRangeText(range) {
  if (!range) return 'unknown';
  if (range.minWidth === range.maxWidth) return `${range.minWidth}px sampled`;
  return `${range.minWidth}-${range.maxWidth}px sampled`;
}

function findingRangeText(finding) {
  const exact = finding.exactRange;
  const sampled = sampledRangeText(finding.sampledRange);

  if (exact?.minWidth !== undefined && exact?.maxWidth !== undefined) {
    return `${exact.minWidth}-${exact.maxWidth}px exact`;
  }

  if (exact?.minWidth !== undefined) {
    return `${sampled}; lower edge ${exact.minWidth}px exact`;
  }

  if (exact?.maxWidth !== undefined) {
    return `${sampled}; upper edge ${exact.maxWidth}px exact`;
  }

  return sampled;
}

function findingLabel(finding) {
  const related = finding.relatedSubjects ?? [];

  if (finding.type === 'disappearance') {
    return `${finding.subject?.key ?? '?'} disappeared`;
  }

  if (finding.type === 'appearance') {
    return `${finding.subject?.key ?? '?'} appeared`;
  }

  if (finding.type === 'reparenting') {
    return `${finding.subject?.key ?? '?'} reparented`;
  }

  if (finding.type === 'overlap') {
    return `${finding.subject?.key ?? '?'} <> ${related[0]?.key ?? '?'}`;
  }

  if (finding.type === 'protrusion') {
    return `${finding.subject?.key ?? '?'} in ${related[0]?.key ?? '?'}`;
  }

  return finding.type ?? 'structural finding';
}

function stateText(state) {
  if (!state) return '?';
  if (state.parent?.key) return `${state.state}: ${state.parent.key}`;
  return state.state ?? '?';
}

export function renderPullRequestComment(report, metadata = {}) {
  const findings = Array.isArray(report.findings) ? report.findings : [];
  const introduced = findings.filter((finding) => finding.direction === 'introduced');
  const resolved = findings.filter((finding) => finding.direction === 'resolved');
  const lines = [PR_COMMENT_MARKER, '## Viewportable Engine', ''];

  if (introduced.length === 0) {
    lines.push('✅ **No structural regressions introduced.**', '');
  } else {
    const suffix = introduced.length === 1 ? 'regression' : 'regressions';
    lines.push(`❌ **${introduced.length} structural ${suffix} introduced.**`, '');
    lines.push('| Range | Finding | Baseline | Candidate |', '| --- | --- | --- | --- |');

    for (const finding of introduced) {
      lines.push(
        `| ${markdownCell(findingRangeText(finding))} | ${markdownCell(findingLabel(finding))} | ` +
          `${markdownCell(stateText(finding.baseline))} | ${markdownCell(stateText(finding.candidate))} |`,
      );
    }

    lines.push('');
  }

  if (resolved.length > 0) {
    lines.push(
      `<details><summary>${resolved.length} resolved structural change${resolved.length === 1 ? '' : 's'}</summary>`,
      '',
    );

    for (const finding of resolved) {
      lines.push(
        `- ${findingRangeText(finding)} - ${findingLabel(finding)}: ` +
          `${stateText(finding.baseline)} -> ${stateText(finding.candidate)}`,
      );
    }

    lines.push('', '</details>', '');
  }

  const artifactUrl = metadata.artifactUrl?.trim();
  if (artifactUrl) {
    lines.push(`[Open structural-diff.json artifact](${artifactUrl})`, '');
  }

  const evidence = [];
  const baselineSha = shortSha(metadata.baselineSha);
  const candidateSha = shortSha(metadata.candidateSha);

  if (baselineSha) evidence.push(`baseline \`${baselineSha}\``);
  if (candidateSha) evidence.push(`candidate \`${candidateSha}\``);
  if (metadata.engineRef) evidence.push(`engine \`${metadata.engineRef}\``);
  if (report.summary?.viewportsChecked !== undefined) {
    evidence.push(`${report.summary.viewportsChecked} viewports`);
  }
  if (report.summary?.durationMs !== undefined) {
    evidence.push(`${(report.summary.durationMs / 1000).toFixed(1)}s`);
  }

  if (evidence.length > 0) {
    lines.push(`<sub>${evidence.join(' · ')}</sub>`, '');
  }

  return `${lines.join('\n')}\n`;
}

async function githubJsonRequest(path, { token, apiUrl, method = 'GET', body } = {}) {
  const response = await fetch(`${apiUrl ?? 'https://api.github.com'}${path}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'viewportable-engine',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub API ${method} ${path} failed: ${response.status} ${text}`);
  }

  return response.status === 204 ? null : response.json();
}

export async function upsertPullRequestComment({
  repository,
  pullRequestNumber,
  body,
  token,
  apiUrl = 'https://api.github.com',
  request = githubJsonRequest,
}) {
  const comments = await request(
    `/repos/${repository}/issues/${pullRequestNumber}/comments?per_page=100`,
    { token, apiUrl },
  );
  const existing = (comments ?? []).find((comment) =>
    String(comment.body ?? '').includes(PR_COMMENT_MARKER),
  );

  if (existing) {
    const comment = await request(`/repos/${repository}/issues/comments/${existing.id}`, {
      token,
      apiUrl,
      method: 'PATCH',
      body: { body },
    });

    return {
      action: 'updated',
      url: comment?.html_url ?? existing.html_url ?? null,
      id: comment?.id ?? existing.id,
    };
  }

  const comment = await request(`/repos/${repository}/issues/${pullRequestNumber}/comments`, {
    token,
    apiUrl,
    method: 'POST',
    body: { body },
  });

  return {
    action: 'created',
    url: comment?.html_url ?? null,
    id: comment?.id ?? null,
  };
}

async function writeOutput(name, value) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) return;
  await appendFile(outputPath, `${name}=${value ?? ''}\n`);
}

async function main() {
  const reportPath = process.argv[2];
  const eventPath = process.env.GITHUB_EVENT_PATH;
  const repository = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;

  if (!reportPath) throw new Error('A structural report path is required');
  if (!eventPath) throw new Error('GITHUB_EVENT_PATH is required');
  if (!repository) throw new Error('GITHUB_REPOSITORY is required');
  if (!token) throw new Error('GITHUB_TOKEN is required');

  const [report, event] = await Promise.all([
    readFile(reportPath, 'utf8').then(JSON.parse),
    readFile(eventPath, 'utf8').then(JSON.parse),
  ]);
  const pullRequest = event.pull_request;

  if (!pullRequest?.number) {
    process.stdout.write('Viewportable PR comment skipped: event has no pull request.\n');
    await writeOutput('comment_action', 'skipped');
    await writeOutput('comment_url', '');
    return;
  }

  const body = renderPullRequestComment(report, {
    artifactUrl: process.env.SLICE_ARTIFACT_URL,
    baselineSha: pullRequest.base?.sha,
    candidateSha: pullRequest.head?.sha,
    engineRef: process.env.SLICE_ENGINE_REF || process.env.SLICE_ENGINE_REPOSITORY,
  });

  const result = await upsertPullRequestComment({
    repository,
    pullRequestNumber: pullRequest.number,
    body,
    token,
    apiUrl: process.env.GITHUB_API_URL,
  });

  await writeOutput('comment_action', result.action);
  await writeOutput('comment_url', result.url ?? '');
  process.stdout.write(
    `Viewportable PR comment ${result.action}${result.url ? `: ${result.url}` : ''}\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
