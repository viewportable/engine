import { describe, expect, it } from 'vitest';
import { inferSiblingRows } from '../src/relationships/rows.js';
import type { LayoutNode } from '../src/types.js';

function node(
  index: number,
  parentIndex: number,
  x: number,
  y: number,
  width = 80,
  height = 30,
): LayoutNode {
  return {
    index,
    parentIndex,
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

describe('inferSiblingRows', () => {
  it('groups horizontally aligned siblings into one row', () => {
    const rows = inferSiblingRows([
      node(1, -1, 0, 0, 390, 80),
      node(2, 1, 0, 10),
      node(3, 1, 90, 10),
      node(4, 1, 180, 10),
      node(5, 1, 270, 10),
    ]).get('snapshot:1');

    expect(rows?.rows).toHaveLength(1);
    expect(rows?.rows[0]?.nodeIndices).toEqual([2, 3, 4, 5]);
  });

  it('separates siblings that move onto another visual row', () => {
    const rows = inferSiblingRows([
      node(1, -1, 0, 0, 320, 120),
      node(2, 1, 0, 10),
      node(3, 1, 90, 10),
      node(4, 1, 180, 10),
      node(5, 1, 0, 50),
    ]).get('snapshot:1');

    expect(rows?.rows).toHaveLength(2);
    expect(rows?.rows[0]?.nodeIndices).toEqual([2, 3, 4]);
    expect(rows?.rows[1]?.nodeIndices).toEqual([5]);
  });

  it('ignores absolutely positioned siblings when inferring flow rows', () => {
    const absolute = node(5, 1, 0, 50);
    absolute.styles.position = 'absolute';

    const rows = inferSiblingRows([
      node(1, -1, 0, 0, 320, 120),
      node(2, 1, 0, 10),
      node(3, 1, 90, 10),
      node(4, 1, 180, 10),
      absolute,
    ]).get('snapshot:1');

    expect(rows?.rows).toHaveLength(1);
    expect(rows?.rows[0]?.nodeIndices).toEqual([2, 3, 4]);
  });
});
