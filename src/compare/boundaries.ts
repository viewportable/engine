import { findBoundary } from '../boundary.js';
import {
  structuralChangeFingerprint,
  type StructuralChangeRange,
  type StructuralRangeBoundary,
} from './ranges.js';
import type { StructuralDiff } from './structural-diff.js';

export type StructuralFingerprintCheck = (width: number, fingerprint: string) => Promise<boolean>;

function fingerprintsAtViewport(viewport: StructuralDiff): Set<string> {
  return new Set(viewport.changes.map((change) => structuralChangeFingerprint(change)));
}

export async function refineIntroducedStructuralRangeBoundaries(
  ranges: StructuralChangeRange[],
  viewports: StructuralDiff[],
  check: StructuralFingerprintCheck,
): Promise<StructuralChangeRange[]> {
  const ordered = [...viewports].sort(
    (first, second) => first.viewport.width - second.viewport.width,
  );
  const indexByWidth = new Map(ordered.map((viewport, index) => [viewport.viewport.width, index]));

  return Promise.all(
    ranges.map(async (range) => {
      if (range.direction !== 'introduced') return range;

      const firstIndex = indexByWidth.get(range.firstWidth);
      const lastIndex = indexByWidth.get(range.lastWidth);
      if (firstIndex === undefined || lastIndex === undefined) return range;

      const boundaries: StructuralRangeBoundary[] = [];
      const lowerNeighbor = ordered[firstIndex - 1];
      const upperNeighbor = ordered[lastIndex + 1];

      if (lowerNeighbor && !fingerprintsAtViewport(lowerNeighbor).has(range.fingerprint)) {
        const result = await findBoundary(
          (width) => check(width, range.fingerprint),
          lowerNeighbor.viewport.width,
          range.firstWidth,
        );
        boundaries.push({
          edge: 'lower',
          sampledPassWidth: lowerNeighbor.viewport.width,
          sampledFailWidth: range.firstWidth,
          ...result,
        });
      }

      if (upperNeighbor && !fingerprintsAtViewport(upperNeighbor).has(range.fingerprint)) {
        const result = await findBoundary(
          (width) => check(width, range.fingerprint),
          upperNeighbor.viewport.width,
          range.lastWidth,
        );
        boundaries.push({
          edge: 'upper',
          sampledPassWidth: upperNeighbor.viewport.width,
          sampledFailWidth: range.lastWidth,
          ...result,
        });
      }

      return {
        ...range,
        boundaries,
      };
    }),
  );
}
