import { describe, expect, it } from 'vitest';
import { detectElementProtrusionCandidates } from '../src/analyze/element-protrusion.js';
import type { LayoutNode } from '../src/types.js';

function node(
  index: number,
  parentIndex: number,
  identity: string,
  rect: LayoutNode['rect'],
  overrides: Partial<LayoutNode> = {},
): LayoutNode {
  return {
    index,
    parentIndex,
    identity,
    tagName: 'DIV',
    attributes: {},
    rect,
    styles: {
      position: 'static',
      overflow: 'visible',
      'overflow-x': 'visible',
      'overflow-y': 'visible',
      display: 'block',
      visibility: 'visible',
      transform: 'none',
    },
    paintOrder: index,
    isVisible: true,
    ...overrides,
  };
}

describe('detectElementProtrusionCandidates', () => {
  it('reports a visible child beyond its captured parent boundary', () => {
    const candidates = detectElementProtrusionCandidates(
      [
        node(
          1,
          -1,
          'parent',
          { x: 100, y: 100, width: 200, height: 80 },
          {
            attributes: { id: 'header' },
          },
        ),
        node(
          2,
          1,
          'child',
          { x: 250, y: 110, width: 80, height: 30 },
          {
            tagName: 'FORM',
            attributes: { id: 'search' },
          },
        ),
      ],
      390,
    );

    expect(candidates).toEqual([
      expect.objectContaining({
        viewportWidth: 390,
        parentLabel: 'div#header',
        childLabel: 'form#search',
        sides: ['right'],
        protrusionPx: {
          left: 0,
          right: 30,
          top: 0,
          bottom: 0,
        },
      }),
    ]);
  });

  it('uses a 1px tolerance', () => {
    const candidates = detectElementProtrusionCandidates(
      [
        node(1, -1, 'parent', { x: 0, y: 0, width: 100, height: 50 }),
        node(2, 1, 'child', { x: 0, y: 0, width: 101, height: 50 }),
      ],
      390,
    );

    expect(candidates).toEqual([]);
  });

  it('ignores fixed and transformed children in the research gate', () => {
    const parent = node(1, -1, 'parent', { x: 0, y: 0, width: 100, height: 50 });
    const fixed = node(
      2,
      1,
      'fixed',
      { x: 90, y: 0, width: 50, height: 20 },
      {
        styles: {
          position: 'fixed',
          overflow: 'visible',
          'overflow-x': 'visible',
          'overflow-y': 'visible',
          display: 'block',
          visibility: 'visible',
          transform: 'none',
        },
      },
    );
    const transformed = node(
      3,
      1,
      'transformed',
      { x: 90, y: 20, width: 50, height: 20 },
      {
        styles: {
          position: 'static',
          overflow: 'visible',
          'overflow-x': 'visible',
          'overflow-y': 'visible',
          display: 'block',
          visibility: 'visible',
          transform: 'matrix(1, 0, 0, 1, 20, 0)',
        },
      },
    );

    expect(detectElementProtrusionCandidates([parent, fixed, transformed], 390)).toEqual([]);
  });
});
