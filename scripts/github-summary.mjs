import { appendFile, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import {
  canonicalRepairPolicies,
  canonicalRepairPolicyForGroup,
  repairPolicyCounts,
  repairPolicyText,
} from './github-repair-policy.mjs';

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
    const review =
      rootCause.assessment?.classification === 'authored-reflow-candidate'
        ? '; review: authored reflow candidate'
        : '';
    const count = observation.wrappedSiblingCount ?? observation.issueIds?.length ?? '?';
    const suffix = count === 1 ? 'sibling' : 'siblings';

    return (
      `wrapping: ${rootCause.selector} (${count} ${suffix} wrap; ` +
      `${observation.stableSiblingCount ?? '?'} stay${review})`
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

function structuralChangeText(change) {
  if (change.kind === 'sibling-overlap') {
    return (
      `${change.subjects?.[0]?.key ?? '?'} <> ${change.subjects?.[1]?.key ?? '?'} ` +
      `${change.baselineState} -> ${change.candidateState}`
    );
  }

  if (change.kind === 'parent-containment') {
    const sides =
      change.candidateState === 'protruding'
        ? change.candidateEvidence?.sides
        : change.baselineEvidence?.sides;
    const suffix = sides?.length > 0 ? ` (${sides.join('/')})` : '';

    return (
      `${change.subject?.key ?? '?'} in ${change.parent?.key ?? '?'} ` +
      `${change.baselineState} -> ${change.candidateState}${suffix}`
    );
  }

  if (change.kind === 'reparenting') {
    return (
      `${change.subject?.key ?? '?'} reparented ` +
      `${change.baselineParent?.key ?? '?'} -> ${change.candidateParent?.key ?? '?'}`
    );
  }

  if (change.kind === 'node-presence') {
    return change.candidateState === 'missing'
      ? `${change.subject?.key ?? '?'} disappeared`
      : `${change.subject?.key ?? '?'} appeared`;
  }

  return change.kind ?? 'structural-change';
}

function structuralRangeWidth(range) {
  const sampled =
    range.firstWidth === range.lastWidth
      ? `${range.firstWidth}px`
      : `${range.firstWidth}-${range.lastWidth}px`;
  const lower = range.boundaries?.find((boundary) => boundary.edge === 'lower');
  const upper = range.boundaries?.find((boundary) => boundary.edge === 'upper');

  if (lower && upper) {
    return `${lower.boundary}-${upper.boundary}px exact | sampled ${sampled}`;
  }

  if (lower) {
    return `${sampled} sampled | lower ${lower.boundary}px exact`;
  }

  if (upper) {
    return `${sampled} sampled | upper ${upper.boundary}px exact`;
  }

  return `${sampled} sampled`;
}

function isStructuralCompareReport(results) {
  return (
    typeof results?.baselineUrl === 'string' &&
    typeof results?.candidateUrl === 'string' &&
    Array.isArray(results?.ranges)
  );
}

export function renderStructuralGitHubSummary(results, agentEvidence = null) {
  const repairPolicies = canonicalRepairPolicies(agentEvidence);
  const repairCounts = repairPolicyCounts(agentEvidence);
  const lines = [
    '## Viewportable Engine compare',
    '',
    `**Baseline:** \`${cell(results.baselineUrl)}\``,
    '',
    `**Candidate:** \`${cell(results.candidateUrl)}\``,
    '',
  ];
  const summary = results.summary ?? {};

  lines.push(
    `**${summary.introducedRanges ?? 0} introduced ranges / ` +
      `${summary.resolvedRanges ?? 0} resolved ranges** · ` +
      `${summary.exactBoundaries ?? 0} exact boundaries · ` +
      `${summary.viewportsChecked ?? 0} viewports checked`,
    '',
    '| Width | Status | Structural changes |',
    '| ---: | :---: | --- |',
  );

  for (const viewport of results.viewports ?? []) {
    const introduced = (viewport.changes ?? []).filter(
      (change) => change.direction === 'introduced',
    );
    const resolved = (viewport.changes ?? []).filter((change) => change.direction === 'resolved');
    const status = introduced.length > 0 ? 'FAIL' : 'PASS';
    const changes = [
      ...introduced.map((change) => `+ ${structuralChangeText(change)}`),
      ...resolved.map((change) => `- ${structuralChangeText(change)}`),
    ];

    lines.push(
      `| ${viewport.viewport?.width ?? '?'}px | ${status} | ` +
        `${cell(changes.join('<br>') || 'No structural changes')} |`,
    );
  }

  if ((results.ranges?.length ?? 0) > 0) {
    lines.push(
      '',
      '### Structural ranges',
      '',
      '| Range | Direction | Change |',
      '| --- | :---: | --- |',
    );

    for (const range of results.ranges) {
      lines.push(
        `| ${cell(structuralRangeWidth(range))} | ${cell(range.direction)} | ` +
          `${cell(structuralChangeText(range.change))} |`,
      );
    }
  }

  const introducedFindings = (results.findings ?? []).filter(
    (finding) => finding.direction === 'introduced',
  );

  if (introducedFindings.length > 0) {
    lines.push('', '### Repair policy', '');

    if (repairCounts.total > 0) {
      lines.push(
        `**${repairCounts.repairable} auto-repairable · ${repairCounts.manual} manual review**`,
        '',
      );
    }

    lines.push('| Finding | Range | Repair |', '| --- | --- | --- |');

    for (const finding of introducedFindings) {
      const range =
        finding.exactRange?.minWidth !== undefined && finding.exactRange?.maxWidth !== undefined
          ? `${finding.exactRange.minWidth}-${finding.exactRange.maxWidth}px exact`
          : `${finding.sampledRange?.minWidth ?? '?'}-${finding.sampledRange?.maxWidth ?? '?'}px sampled`;

      lines.push(
        `| ${cell(finding.type)} | ${cell(range)} | ${cell(
          repairPolicyText(repairPolicies.get(finding.id)),
        )} |`,
      );
    }
  }

  lines.push('');
  return `${lines.join('\n')}\n`;
}

function renderScanGitHubSummary(results, agentEvidence = null) {
  const lines = ['## Viewportable Engine', ''];
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
    lines.push(
      '',
      '### Root causes',
      '',
      '| Root | Boundary | Reason | Repair |',
      '| --- | ---: | --- | --- |',
    );

    for (const rootCause of results.rootCauses) {
      const boundaries = rootCause.boundaries?.map((boundary) => `${boundary.boundary}px`) ?? [];
      const reason =
        rootCause.type === 'wrapping'
          ? [
              'Grouped sibling wrapping',
              rootCause.assessment?.classification === 'authored-reflow-candidate'
                ? 'review: authored reflow candidate'
                : null,
              rootCause.evidence?.transitionCount
                ? `${rootCause.evidence.transitionCount} transition${rootCause.evidence.transitionCount === 1 ? '' : 's'}`
                : null,
            ]
              .filter(Boolean)
              .join(' · ')
          : rootCause.diagnosis
            ? `${rootCause.diagnosis.property}: ${rootCause.diagnosis.value}`
            : 'Grouped layout overflow';

      const repair = canonicalRepairPolicyForGroup(agentEvidence, rootCause.id);

      lines.push(
        `| ${cell(rootCause.selector)} | ${cell(boundaries.join(', ') || '-')} | ${cell(reason)} | ` +
          `${cell(repairPolicyText(repair))} |`,
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

export function renderGitHubSummary(results, agentEvidence = null) {
  return isStructuralCompareReport(results)
    ? renderStructuralGitHubSummary(results, agentEvidence)
    : renderScanGitHubSummary(results, agentEvidence);
}

async function main() {
  const reportPath = process.argv[2];
  const agentEvidencePath = process.argv[3] || process.env.SLICE_AGENT_EVIDENCE_PATH;
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;

  if (!summaryPath) return;

  if (!reportPath) {
    await appendFile(summaryPath, '## Viewportable Engine\n\nNo report path was provided.\n');
    return;
  }

  try {
    const [results, agentEvidence] = await Promise.all([
      readFile(reportPath, 'utf8').then(JSON.parse),
      agentEvidencePath
        ? readFile(agentEvidencePath, 'utf8')
            .then(JSON.parse)
            .catch(() => null)
        : null,
    ]);
    await appendFile(summaryPath, renderGitHubSummary(results, agentEvidence));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await appendFile(
      summaryPath,
      `## Viewportable Engine\n\nViewportable Engine did not produce a readable report.\n\n${cell(message)}\n`,
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
