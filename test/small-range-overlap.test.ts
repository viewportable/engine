import { describe, expect, it } from 'vitest';
import { detectSmallRangeOverlapCandidates } from '../src/analyze/small-range-overlap.js';
import { overlapRelationshipState } from '../src/relationships/overlap.js';
import type { LayoutNode } from '../src/types.js';

function node(
  index: number,
  parentIndex: number,
  identity: string,
  x: number,
  y: number,
  width = 100,
  height = 40,
): LayoutNode {
  return {
    index,
    parentIndex,
    identity,
    tagName: 'DIV',
    attributes: {},
    rect: { x, y, width, height },
    styles: {
      position: 'static',
      overflow: 'visible',
      'overflow-x': 'visible',
      display: 'block',
      visibility: 'visible',
      transform: 'none',
    },
    paintOrder: index,
    isVisible: true,
  };
}

function sample(width: number, secondX: number, includeSecond = true) {
  const parent = node(1, -1, 'parent', 0, 0, width, 100);
  const first = node(2, 1, 'first', 0, 10);
  const nodes = [parent, first];

  if (includeSecond) {
    nodes.push(node(3, 1, 'second', secondX, 10));
  }

  return { width, nodes };
}

describe('overlapRelationshipState', () => {
  it('uses the shared 1px structural tolerance', () => {
    expect(
      overlapRelationshipState(
        { x: 0, y: 0, width: 100, height: 40 },
        { x: 99, y: 0, width: 100, height: 40 },
      ),
    ).toBe('separate');

    expect(
      overlapRelationshipState(
        { x: 0, y: 0, width: 100, height: 40 },
        { x: 98, y: 0, width: 100, height: 40 },
      ),
    ).toBe('overlap');
  });
});

describe('detectSmallRangeOverlapCandidates', () => {
  it('finds a sampled separate -> overlap -> separate sibling relation', () => {
    const candidates = detectSmallRangeOverlapCandidates([
      sample(989, 101),
      sample(990, 98),
      sample(991, 98),
      sample(992, 101),
    ]);

    expect(candidates).toEqual([
      {
        parentIdentity: 'parent',
        parentLabel: 'div',
        firstIdentity: 'first',
        firstLabel: 'div',
        secondIdentity: 'second',
        secondLabel: 'div',
        interval: {
          state: 'overlap',
          minSampleWidth: 990,
          maxSampleWidth: 991,
          sampleWidths: [990, 991],
          sampleCount: 2,
        },
        sampledSpanPx: 1,
      },
    ]);
  });

  it('does not report persistent overlap as a small-range candidate', () => {
    expect(
      detectSmallRangeOverlapCandidates([
        sample(989, 98),
        sample(990, 98),
        sample(991, 98),
        sample(992, 98),
      ]),
    ).toEqual([]);
  });

  it('requires the pair to be observable at every supplied sample width', () => {
    expect(
      detectSmallRangeOverlapCandidates([
        sample(989, 101),
        sample(990, 98),
        sample(991, 98, false),
        sample(992, 101),
      ]),
    ).toEqual([]);
  });
});
