import { appendFile, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

function cell(value) {
  return String(value ?? '')
    .replaceAll('|', '\\|')
    .replace(/[\r\n]+/g, ' ')
    .trim();
}

function issueText(issue) {
  if (issue.type === 'horizontal-overflow') {
    return `${issue.type}: ${issue.selector} (${issue.overflowPx}px ${issue.side})`;
  }

  if (issue.type === 'fixed-element-collision') {
    return `${issue.type}: ${issue.selector} overlaps ${issue.otherSelector}`;
  }

  if (issue.type === 'fixed-content-occlusion') {
    return `${issue.type}: ${issue.selector} covers ${issue.targetSelector} (${issue.targetCoveragePct}%)`;
  }

  if (issue.type === 'wrapping') {
    return (
      `${issue.type}: ${issue.selector} wraps below siblings ` +
      `(${issue.evidence?.stableSiblingCount ?? '?'} stay)`
    );
  }

  return `${issue.type}: ${issue.selector}`;
}

function rootCauseObservationAtWidth(rootCause, width) {
  return rootCause.observations?.find((observation) => observation.viewportWidth === width) ?? null;
}

function rootCauseText(rootCause, observation) {
  if (rootCause.type === 'wrapping') {
    const authored = rootCause.evidence?.authoredFlexWrap ? '; authored flex-wrap' : '';
    const count = observation.wrappedSiblingCount ?? observation.issueIds?.length ?? '?';
    const suffix = count === 1 ? 'sibling' : 'siblings';

    return (
      `wrapping: ${rootCause.selector} (${count} ${suffix} wrap; ` +
      `${observation.stableSiblingCount ?? '?'} stay${authored})`
    );
  }

  if (rootCause.type === 'horizontal-overflow') {
    const affected = observation.issueIds?.length ?? rootCause.issueIds?.length ?? '?';
    return (
      `horizontal-overflow: ${rootCause.selector} ` +
      `(${observation.overflowPx ?? '?'}px ${rootCause.side}; ${affected} affected)`
    );
  }

  return `${rootCause.type}: ${rootCause.selector}`;
}

function viewportFindingTexts(viewport, rootCauses) {
  const rootsAtWidth = (rootCauses ?? [])
    .map((rootCause) => ({
      rootCause,
      observation: rootCauseObservationAtWidth(rootCause, viewport.width),
    }))
    .filter((entry) => entry.observation !== null);

  const groupedIssueIds = new Set(
    rootsAtWidth.flatMap(({ observation }) => observation.issueIds ?? []),
  );
  const ungroupedIssues = (viewport.issues ?? []).filter((issue) => !groupedIssueIds.has(issue.id));

  return [
    ...rootsAtWidth.map(({ rootCause, observation }) => rootCauseText(rootCause, observation)),
    ...ungroupedIssues.map(issueText),
  ];
}

export function renderGitHubSummary(results) {
  const lines = ['## Slice', ''];
  const summary = results.summary ?? {};
  const failing = results.viewports?.filter((viewport) => viewport.status === 'fail') ?? [];
  const suppressed = summary.suppressedIssues ?? 0;

  lines.push(
    `**${failing.length} failing viewports / ${summary.viewportsChecked ?? 0} checked**` +
      (suppressed > 0 ? ` · ${suppressed} suppressed` : ''),
    '',
  );

  lines.push('| Width | Status | Findings |', '| ---: | :---: | --- |');
  for (const viewport of results.viewports ?? []) {
    const findingTexts = viewportFindingTexts(viewport, results.rootCauses);
    const findings =
      findingTexts.length > 0
        ? findingTexts.map((finding) => cell(finding)).join('<br>')
        : viewport.suppressedIssues?.length > 0
          ? `${viewport.suppressedIssues.length} suppressed`
          : 'Clean';

    lines.push(`| ${viewport.width}px | ${viewport.status.toUpperCase()} | ${findings} |`);
  }

  if ((results.rootCauses?.length ?? 0) > 0) {
    lines.push('', '### Root causes', '', '| Root | Boundary | Reason |', '| --- | ---: | --- |');

    for (const rootCause of results.rootCauses) {
      const boundaries = rootCause.boundaries?.map((boundary) => `${boundary.boundary}px`) ?? [];
      const reason =
        rootCause.type === 'wrapping'
          ? [
              'Grouped sibling wrapping',
              rootCause.evidence?.authoredFlexWrap ? 'authored flex-wrap' : null,
              rootCause.evidence?.transitionCount
                ? `${rootCause.evidence.transitionCount} transition${rootCause.evidence.transitionCount === 1 ? '' : 's'}`
                : null,
            ]
              .filter(Boolean)
              .join(' · ')
          : rootCause.diagnosis
            ? `${rootCause.diagnosis.property}: ${rootCause.diagnosis.value}`
            : 'Grouped layout overflow';

      lines.push(
        `| ${cell(rootCause.selector)} | ${cell(boundaries.join(', ') || '-')} | ${cell(reason)} |`,
      );
    }
  }

  if ((results.boundaries?.length ?? 0) > 0) {
    lines.push(
      '',
      '### Issue boundaries',
      '',
      '| Issue | Type | Breaks at |',
      '| --- | --- | ---: |',
    );

    for (const boundary of results.boundaries) {
      lines.push(
        `| ${cell(boundary.issueId)} | ${cell(boundary.issueType)} | ${boundary.boundary}px |`,
      );
    }
  }

  lines.push('');
  return `${lines.join('\n')}\n`;
}

async function main() {
  const reportPath = process.argv[2];
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;

  if (!summaryPath) return;

  if (!reportPath) {
    await appendFile(summaryPath, '## Slice\n\nNo report path was provided.\n');
    return;
  }

  try {
    const results = JSON.parse(await readFile(reportPath, 'utf8'));
    await appendFile(summaryPath, renderGitHubSummary(results));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await appendFile(
      summaryPath,
      `## Slice\n\nSlice did not produce a readable report.\n\n${cell(message)}\n`,
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
