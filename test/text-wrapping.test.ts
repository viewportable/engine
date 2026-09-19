import { describe, expect, it } from 'vitest';
import { detectTextWrappingTransitions } from '../src/analyze/text-wrapping.js';
import type { SurfaceTextBox } from '../src/surface.js';
import type { LayoutNode } from '../src/types.js';

function node(
  index: number,
  parentIndex: number,
  identity: string,
  x: number,
  y: number,
  width = 100,
  height = 28,
): LayoutNode {
  return {
    index,
    parentIndex,
    identity,
    tagName: index === 1 ? 'UL' : 'LI',
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

function textBox(
  ownerIdentity: string,
  x: number,
  y: number,
  width = 80,
  height = 16,
): SurfaceTextBox {
  return {
    ownerIdentity,
    rect: { x, y, width, height },
    start: 0,
    length: 10,
  };
}

function sample(
  width: number,
  lineCounts: [number, number, number, number],
): { width: number; nodes: LayoutNode[]; textBoxes: SurfaceTextBox[] } {
  const nodes = [
    node(1, -1, 'parent', 0, 0, width, 80),
    node(2, 1, 'a', 0, 10),
    node(3, 1, 'b', 100, 10),
    node(4, 1, 'c', 200, 10),
    node(5, 1, 'd', 300, 10),
  ];
  const identities = ['a', 'b', 'c', 'd'];
  const textBoxes: SurfaceTextBox[] = [];

  lineCounts.forEach((count, index) => {
    for (let line = 0; line < count; line += 1) {
      textBoxes.push(textBox(identities[index] ?? '', index * 100, 10 + line * 18));
    }
  });

  return { width, nodes, textBoxes };
}

describe('detectTextWrappingTransitions', () => {
  it('detects one text subject changing from one line to two while siblings stay stable', () => {
    const findings = detectTextWrappingTransitions([
      sample(430, [1, 1, 1, 1]),
      sample(320, [1, 1, 1, 2]),
    ]);

    expect(findings).toEqual([
      expect.objectContaining({
        nodeIndex: 5,
        parentIndex: 1,
        viewportWidth: 320,
        previousViewportWidth: 430,
        previousLineCount: 1,
        currentLineCount: 2,
        stableSiblingCount: 3,
        changedSiblingCount: 1,
      }),
    ]);
  });

  it('does not flag text that is already multiline at the wider viewport', () => {
    expect(
      detectTextWrappingTransitions([sample(430, [1, 1, 1, 2]), sample(320, [1, 1, 1, 3])]),
    ).toEqual([]);
  });

  it('does not flag coordinated text reflow affecting most siblings', () => {
    expect(
      detectTextWrappingTransitions([sample(430, [1, 1, 1, 1]), sample(320, [2, 2, 2, 1])]),
    ).toEqual([]);
  });
});
