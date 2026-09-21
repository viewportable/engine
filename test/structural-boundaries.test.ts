import { describe, expect, it } from 'vitest';
import { refineIntroducedStructuralRangeBoundaries } from '../src/compare/boundaries.js';
import { aggregateStructuralChangeRanges } from '../src/compare/ranges.js';
import type {
  SiblingOverlapStructuralChange,
  StructuralChange,
  StructuralDiff,
} from '../src/compare/structural-diff.js';

function overlap(
  width: number,
  direction: 'introduced' | 'resolved' = 'introduced',
): SiblingOverlapStructuralChange {
  return {
    kind: 'sibling-overlap',
    direction,
    viewport: { width, height: 900 },
    parent: { key: 'id:row', quality: 'explicit', tagName: 'DIV' },
    subjects: [
      { key: 'id:first', quality: 'explicit', tagName: 'DIV' },
      { key: 'id:second', quality: 'explicit', tagName: 'DIV' },
    ],
    baselineState: direction === 'introduced' ? 'separate' : 'overlap',
    candidateState: direction === 'introduced' ? 'overlap' : 'separate',
  };
}

function viewport(width: number, changes: StructuralChange[]): StructuralDiff {
  return {
    platform: 'web',
    viewport: { width, height: 900 },
    matchedNodes: 3,
    changes,
  };
}

describe('refineIntroducedStructuralRangeBoundaries', () => {
  it('finds exact lower and upper boundaries around a sampled introduced range', async () => {
    const viewports = [
      viewport(320, []),
      viewport(375, [overlap(375)]),
      viewport(430, [overlap(430)]),
      viewport(520, []),
    ];
    const ranges = aggregateStructuralChangeRanges(viewports);

    const refined = await refineIntroducedStructuralRangeBoundaries(
      ranges,
      viewports,
      async (width) => width >= 350 && width <= 499,
    );

    expect(refined[0]?.boundaries).toEqual([
      {
        edge: 'lower',
        sampledPassWidth: 320,
        sampledFailWidth: 375,
        boundary: 350,
        lastGoodWidth: 349,
        firstBadWidth: 350,
        probesUsed: expect.any(Number),
      },
      {
        edge: 'upper',
        sampledPassWidth: 520,
        sampledFailWidth: 430,
        boundary: 499,
        lastGoodWidth: 500,
        firstBadWidth: 499,
        probesUsed: expect.any(Number),
      },
    ]);
  });

  it('does not invent a boundary when the range touches the sampled matrix edge', async () => {
    const viewports = [
      viewport(375, [overlap(375)]),
      viewport(430, [overlap(430)]),
      viewport(520, []),
    ];
    const ranges = aggregateStructuralChangeRanges(viewports);

    const refined = await refineIntroducedStructuralRangeBoundaries(
      ranges,
      viewports,
      async (width) => width <= 499,
    );

    expect(refined[0]?.boundaries.map((boundary) => boundary.edge)).toEqual(['upper']);
  });

  it('leaves resolved ranges sampled-only', async () => {
    const viewports = [
      viewport(320, []),
      viewport(375, [overlap(375, 'resolved')]),
      viewport(430, []),
    ];
    const ranges = aggregateStructuralChangeRanges(viewports);
    let probes = 0;

    const refined = await refineIntroducedStructuralRangeBoundaries(
      ranges,
      viewports,
      async () => {
        probes += 1;
        return false;
      },
    );

    expect(refined[0]?.boundaries).toEqual([]);
    expect(probes).toBe(0);
  });
});
