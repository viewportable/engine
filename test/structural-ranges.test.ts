import { describe, expect, it } from 'vitest';
import {
  aggregateStructuralChangeRanges,
  structuralChangeFingerprint,
} from '../src/compare/ranges.js';
import type { StructuralChange, StructuralDiff } from '../src/compare/structural-diff.js';

function overlap(
  width: number,
  direction: 'introduced' | 'resolved' = 'introduced',
): StructuralChange {
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

describe('aggregateStructuralChangeRanges', () => {
  it('groups the same relationship across consecutive sampled viewports', () => {
    const ranges = aggregateStructuralChangeRanges([
      viewport(320, []),
      viewport(375, [overlap(375)]),
      viewport(390, [overlap(390)]),
      viewport(430, [overlap(430)]),
      viewport(768, []),
    ]);

    expect(ranges).toEqual([
      expect.objectContaining({
        direction: 'introduced',
        firstWidth: 375,
        lastWidth: 430,
        sampleWidths: [375, 390, 430],
        sampleCount: 3,
      }),
    ]);
  });

  it('normalizes viewport order before building the range', () => {
    const ranges = aggregateStructuralChangeRanges([
      viewport(430, [overlap(430)]),
      viewport(375, [overlap(375)]),
      viewport(390, [overlap(390)]),
    ]);

    expect(ranges[0]).toMatchObject({
      firstWidth: 375,
      lastWidth: 430,
      sampleWidths: [375, 390, 430],
    });
  });

  it('splits the same fingerprint when a sampled viewport interrupts the change', () => {
    const ranges = aggregateStructuralChangeRanges([
      viewport(320, [overlap(320)]),
      viewport(375, []),
      viewport(390, [overlap(390)]),
    ]);

    expect(ranges.map((range) => [range.firstWidth, range.lastWidth])).toEqual([
      [320, 320],
      [390, 390],
    ]);
  });

  it('keeps introduced and resolved changes separate', () => {
    const introduced = overlap(375, 'introduced');
    const resolved = overlap(390, 'resolved');

    expect(structuralChangeFingerprint(introduced)).not.toBe(structuralChangeFingerprint(resolved));
  });

  it('normalizes sibling order in the fingerprint', () => {
    const first = overlap(390);
    const reversed: StructuralChange = {
      ...first,
      subjects: [first.subjects[1], first.subjects[0]],
    };

    expect(structuralChangeFingerprint(first)).toBe(structuralChangeFingerprint(reversed));
  });
});
