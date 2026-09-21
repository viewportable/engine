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

function renderRangeWidth(
  firstWidth: number,
  lastWidth: number,
  boundaries: StructuralCompareReport['ranges'][number]['boundaries'],
): string {
  const sampled =
    firstWidth === lastWidth ? `${firstWidth}px` : `${firstWidth}-${lastWidth}px`;
  const lower = boundaries.find((boundary) => boundary.edge === 'lower');
  const upper = boundaries.find((boundary) => boundary.edge === 'upper');

  if (lower && upper) {
    return `${lower.boundary}-${upper.boundary}px exact | sampled ${sampled}`;
  }

  if (lower) {
    return `${sampled} sampled | lower edge ${lower.boundary}px exact`;
  }

  if (upper) {
    return `${sampled} sampled | upper edge ${upper.boundary}px exact`;
  }

  return `${sampled} sampled`;
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
  }

  if (report.ranges.length > 0) {
    process.stdout.write('\n  Structural ranges\n');

    for (const range of report.ranges) {
      const symbol = range.direction === 'introduced' ? '+' : '-';
      const width = renderRangeWidth(range.firstWidth, range.lastWidth, range.boundaries);
      const samples = range.sampleCount > 1 ? ` | ${range.sampleCount} sampled widths` : '';

      process.stdout.write(`    ${symbol} ${width}  ${renderChange(range.change)}${samples}\n`);
    }
  }

  process.stdout.write(
    [
      '',
      `  ${report.summary.introducedRanges} introduced ranges | ` +
        `${report.summary.resolvedRanges} resolved ranges | ` +
        `${report.summary.totalChanges} raw observations | ` +
        `${report.summary.exactBoundaries} exact boundaries / ` +
        `${report.summary.boundaryProbes} probes in ` +
        `${report.summary.viewportsChecked} viewports | ` +
        `${(report.summary.durationMs / 1000).toFixed(1)}s`,
      `  ${outputPath}`,
      '',
    ].join('\n'),
  );
}
