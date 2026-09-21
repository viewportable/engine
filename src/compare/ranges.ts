import type { BoundarySearchResult } from '../boundary.js';
import type {
  StructuralChange,
  StructuralChangeDirection,
  StructuralDiff,
} from './structural-diff.js';

export interface StructuralRangeBoundary extends BoundarySearchResult {
  edge: 'lower' | 'upper';
  sampledPassWidth: number;
  sampledFailWidth: number;
}

export interface StructuralChangeRange {
  fingerprint: string;
  kind: StructuralChange['kind'];
  direction: StructuralChangeDirection;
  firstWidth: number;
  lastWidth: number;
  sampleWidths: number[];
  sampleCount: number;
  change: StructuralChange;
  boundaries: StructuralRangeBoundary[];
}

export function structuralChangeFingerprint(change: StructuralChange): string {
  if (change.kind === 'sibling-overlap') {
    const subjects = change.subjects.map((subject) => subject.key).sort();

    return [
      change.kind,
      change.direction,
      change.parent.key,
      subjects[0],
      subjects[1],
      change.baselineState,
      change.candidateState,
    ].join('|');
  }

  return [
    change.kind,
    change.direction,
    change.parent.key,
    change.subject.key,
    change.baselineState,
    change.candidateState,
  ].join('|');
}

export function aggregateStructuralChangeRanges(
  viewports: StructuralDiff[],
): StructuralChangeRange[] {
  const active = new Map<string, StructuralChangeRange>();
  const completed: StructuralChangeRange[] = [];
  const orderedViewports = [...viewports].sort(
    (first, second) => first.viewport.width - second.viewport.width,
  );

  for (const viewport of orderedViewports) {
    const changesByFingerprint = new Map(
      viewport.changes.map((change) => [structuralChangeFingerprint(change), change]),
    );
    const currentFingerprints = new Set(changesByFingerprint.keys());

    for (const [fingerprint, range] of active) {
      if (currentFingerprints.has(fingerprint)) continue;
      completed.push(range);
      active.delete(fingerprint);
    }

    for (const [fingerprint, change] of changesByFingerprint) {
      const existing = active.get(fingerprint);

      if (existing) {
        existing.lastWidth = viewport.viewport.width;
        existing.sampleWidths.push(viewport.viewport.width);
        existing.sampleCount = existing.sampleWidths.length;
        continue;
      }

      active.set(fingerprint, {
        fingerprint,
        kind: change.kind,
        direction: change.direction,
        firstWidth: viewport.viewport.width,
        lastWidth: viewport.viewport.width,
        sampleWidths: [viewport.viewport.width],
        sampleCount: 1,
        change,
        boundaries: [],
      });
    }
  }

  completed.push(...active.values());

  return completed.sort((first, second) => {
    const direction = first.direction.localeCompare(second.direction);
    if (direction !== 0) return direction;

    const width = first.firstWidth - second.firstWidth;
    if (width !== 0) return width;

    return first.fingerprint.localeCompare(second.fingerprint);
  });
}
