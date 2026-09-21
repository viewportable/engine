import { appendFile, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { findingLabel, findingRangeText, stateText } from './github-pr-comment.mjs';

export const CHECK_RUN_NAME = 'Viewportable Engine';

function markdownCell(value) {
  return String(value ?? '')
    .replaceAll('|', '\\|')
    .replace(/[\r\n]+/g, ' ')
    .trim();
}

function plural(count, singular, pluralForm = `${singular}s`) {
  return count === 1 ? singular : pluralForm;
}

export function checkConclusion(exitCode) {
  if (String(exitCode) === '0') return 'success';
  if (String(exitCode) === '1') return 'failure';
  return 'action_required';
}

export function renderCheckOutput(report, exitCode) {
  const findings = Array.isArray(report?.findings) ? report.findings : [];
  const introduced = findings.filter((finding) => finding.direction === 'introduced');
  const resolved = findings.filter((finding) => finding.direction === 'resolved');
  const code = String(exitCode ?? '2');

  if (code === '2' || !report) {
    return {
      title: 'Comparison could not complete',
      summary:
        'Viewportable Engine could not complete structural comparison. Review the workflow logs and retry after fixing the scanner or application setup failure.',
    };
  }

  const lines = [];

  if (introduced.length === 0) {
    lines.push('✅ No structural regressions introduced.');
  } else {
    lines.push(
      `❌ ${introduced.length} structural ${plural(introduced.length, 'regression')} introduced.`,
      '',
      '| Range | Finding | Baseline | Candidate |',
      '| --- | --- | --- | --- |',
    );

    for (const finding of introduced) {
      lines.push(
        `| ${markdownCell(findingRangeText(finding))} | ${markdownCell(findingLabel(finding))} | ` +
          `${markdownCell(stateText(finding.baseline))} | ${markdownCell(stateText(finding.candidate))} |`,
      );
    }
  }

  if (resolved.length > 0) {
    lines.push(
      '',
      `${resolved.length} resolved structural ${plural(resolved.length, 'change')} retained as evidence.`,
    );
  }

  const summary = report?.summary ?? {};
  const evidence = [];

  if (summary.viewportsChecked !== undefined) {
    evidence.push(`${summary.viewportsChecked} viewports`);
  }
  if (summary.exactBoundaries !== undefined) {
    evidence.push(`${summary.exactBoundaries} exact boundaries`);
  }
  if (summary.durationMs !== undefined) {
    evidence.push(`${(summary.durationMs / 1000).toFixed(1)}s`);
  }

  if (evidence.length > 0) {
    lines.push('', `_${evidence.join(' · ')}_`);
  }

  return {
    title:
      introduced.length === 0
        ? 'No structural regressions'
        : `${introduced.length} structural ${plural(introduced.length, 'regression')} introduced`,
    summary: lines.join('\n'),
  };
}

function externalId(pullRequestNumber, headSha) {
  return `viewportable-engine:pr:${pullRequestNumber}:head:${headSha}`;
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

export async function upsertCheckRun({
  repository,
  pullRequestNumber,
  headSha,
  exitCode,
  report,
  detailsUrl,
  token,
  apiUrl = 'https://api.github.com',
  request = githubJsonRequest,
}) {
  const id = externalId(pullRequestNumber, headSha);
  const encodedName = encodeURIComponent(CHECK_RUN_NAME);
  const list = await request(
    `/repos/${repository}/commits/${headSha}/check-runs?check_name=${encodedName}&per_page=100`,
    { token, apiUrl },
  );
  const existing = (list?.check_runs ?? []).find(
    (check) => check.name === CHECK_RUN_NAME && check.external_id === id,
  );
  const output = renderCheckOutput(report, exitCode);
  const body = {
    name: CHECK_RUN_NAME,
    status: 'completed',
    conclusion: checkConclusion(exitCode),
    external_id: id,
    ...(detailsUrl ? { details_url: detailsUrl } : {}),
    output,
  };

  if (existing) {
    const check = await request(`/repos/${repository}/check-runs/${existing.id}`, {
      token,
      apiUrl,
      method: 'PATCH',
      body,
    });

    return {
      action: 'updated',
      id: check?.id ?? existing.id,
      url: check?.html_url ?? existing.html_url ?? null,
      conclusion: body.conclusion,
    };
  }

  const check = await request(`/repos/${repository}/check-runs`, {
    token,
    apiUrl,
    method: 'POST',
    body: {
      ...body,
      head_sha: headSha,
    },
  });

  return {
    action: 'created',
    id: check?.id ?? null,
    url: check?.html_url ?? null,
    conclusion: body.conclusion,
  };
}

async function writeOutput(name, value) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) return;
  await appendFile(outputPath, `${name}=${value ?? ''}\n`);
}

async function readJsonOrNull(path) {
  if (!path) return null;

  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
}

async function main() {
  const reportPath = process.argv[2];
  const eventPath = process.env.GITHUB_EVENT_PATH;
  const repository = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  const exitCode = process.env.SLICE_EXIT_CODE ?? '2';

  if (!eventPath) throw new Error('GITHUB_EVENT_PATH is required');
  if (!repository) throw new Error('GITHUB_REPOSITORY is required');
  if (!token) throw new Error('GITHUB_TOKEN is required');

  const [report, event] = await Promise.all([
    readJsonOrNull(reportPath),
    readFile(eventPath, 'utf8').then(JSON.parse),
  ]);
  const pullRequest = event.pull_request;

  if (!pullRequest?.number || !pullRequest.head?.sha) {
    process.stdout.write('Viewportable Check Run skipped: event has no pull request head.\n');
    await writeOutput('check_action', 'skipped');
    await writeOutput('check_url', '');
    return;
  }

  const fallbackDetailsUrl =
    process.env.GITHUB_SERVER_URL && repository && process.env.GITHUB_RUN_ID
      ? `${process.env.GITHUB_SERVER_URL}/${repository}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : null;
  const detailsUrl = process.env.SLICE_ARTIFACT_URL?.trim() || fallbackDetailsUrl;

  const result = await upsertCheckRun({
    repository,
    pullRequestNumber: pullRequest.number,
    headSha: pullRequest.head.sha,
    exitCode,
    report,
    detailsUrl,
    token,
    apiUrl: process.env.GITHUB_API_URL,
  });

  await writeOutput('check_action', result.action);
  await writeOutput('check_url', result.url ?? '');
  await writeOutput('check_conclusion', result.conclusion);
  process.stdout.write(
    `Viewportable Check Run ${result.action} with ${result.conclusion}${result.url ? `: ${result.url}` : ''}\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
