import pc from 'picocolors';
import type { StructuralChange } from './structural-diff.js';
import type { StructuralCompareReport } from './run.js';

function renderChange(change: StructuralChange): string {
  if (change.kind === 'sibling-overlap') {
    return (
      `${change.subjects[0].key} <> ${change.subjects[1].key} ` +
      `${change.baselineState} -> ${change.candidateState}`
    );
  }

  const sides =
    change.candidateState === 'protruding'
      ? change.candidateEvidence.sides.join('/')
      : change.baselineEvidence.sides.join('/');

  return (
    `${change.subject.key} in ${change.parent.key} ` +
    `${change.baselineState} -> ${change.candidateState}` +
    (sides ? ` (${sides})` : '')
  );
}

export function renderStructuralCompareReport(
  report: StructuralCompareReport,
  outputPath: string,
): void {
  process.stdout.write(
    [
      '',
      `  Viewportable Engine compare`,
      `  baseline  ${report.baselineUrl}`,
      `  candidate ${report.candidateUrl}`,
      '',
    ].join('\n'),
  );

  for (const viewport of report.viewports) {
    const introduced = viewport.changes.filter((change) => change.direction === 'introduced');
    const resolved = viewport.changes.filter((change) => change.direction === 'resolved');
    const status = introduced.length > 0 ? pc.red('FAIL') : pc.green('PASS');

    process.stdout.write(
      `  ${String(viewport.viewport.width).padEnd(5)} ${status}  ` +
        `${introduced.length} introduced | ${resolved.length} resolved | ` +
        `${viewport.matchedNodes} matched nodes\n`,
    );

    for (const change of introduced.slice(0, 4)) {
      process.stdout.write(`        + ${renderChange(change)}\n`);
    }

    for (const change of resolved.slice(0, 2)) {
      process.stdout.write(`        - ${renderChange(change)}\n`);
    }

    const hidden = Math.max(0, viewport.changes.length - 6);
    if (hidden > 0) {
      process.stdout.write(`        ... ${hidden} more changes\n`);
    }
  }

  process.stdout.write(
    [
      '',
      `  ${report.summary.introducedChanges} introduced | ` +
        `${report.summary.resolvedChanges} resolved in ` +
        `${report.summary.viewportsChecked} viewports | ` +
        `${(report.summary.durationMs / 1000).toFixed(1)}s`,
      `  ${outputPath}`,
      '',
    ].join('\n'),
  );
}
