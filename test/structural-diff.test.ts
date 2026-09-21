import { describe, expect, it } from 'vitest';
import { compareStructuralSurfaces } from '../src/compare/structural-diff.js';
import type { SurfaceSnapshot } from '../src/surface.js';
import type { LayoutNode } from '../src/types.js';

function node(
  index: number,
  parentIndex: number,
  id: string,
  rect: LayoutNode['rect'],
  overrides: Partial<LayoutNode> = {},
): LayoutNode {
  return {
    index,
    parentIndex,
    identity: `runtime:${index}`,
    tagName: 'DIV',
    attributes: { id },
    rect,
    styles: {
      position: 'static',
      transform: 'none',
    },
    paintOrder: index,
    isVisible: true,
    nthChild: index,
    ...overrides,
  };
}

function surface(nodes: LayoutNode[]): SurfaceSnapshot<LayoutNode> {
  return {
    platform: 'web',
    viewport: { width: 768, height: 900 },
    capabilities: ['geometry', 'tree', 'computed-styles'],
    nodes,
  };
}

describe('compareStructuralSurfaces', () => {
  it('reports an introduced sibling overlap and ignores unchanged relations', () => {
    const baseline = surface([
      node(1, -1, 'row', { x: 0, y: 0, width: 300, height: 100 }),
      node(2, 1, 'first', { x: 0, y: 0, width: 100, height: 40 }),
      node(3, 1, 'second', { x: 120, y: 0, width: 100, height: 40 }),
      node(4, 1, 'third', { x: 240, y: 0, width: 40, height: 40 }),
    ]);
    const candidate = surface([
      node(20, -1, 'row', { x: 0, y: 0, width: 300, height: 100 }),
      node(21, 20, 'first', { x: 0, y: 0, width: 100, height: 40 }),
      node(22, 20, 'second', { x: 90, y: 0, width: 100, height: 40 }),
      node(23, 20, 'third', { x: 240, y: 0, width: 40, height: 40 }),
    ]);

    const diff = compareStructuralSurfaces(baseline, candidate);

    expect(diff.matchedNodes).toBe(4);
    expect(diff.changes).toContainEqual({
      kind: 'sibling-overlap',
      direction: 'introduced',
      viewport: { width: 768, height: 900 },
      parent: {
        key: 'id:row',
        quality: 'explicit',
        tagName: 'DIV',
      },
      subjects: [
        { key: 'id:first', quality: 'explicit', tagName: 'DIV' },
        { key: 'id:second', quality: 'explicit', tagName: 'DIV' },
      ],
      baselineState: 'separate',
      candidateState: 'overlap',
    });
    expect(diff.changes.filter((change) => change.kind === 'sibling-overlap')).toHaveLength(1);
  });

  it('reports a resolved sibling overlap', () => {
    const baseline = surface([
      node(1, -1, 'row', { x: 0, y: 0, width: 300, height: 100 }),
      node(2, 1, 'first', { x: 0, y: 0, width: 100, height: 40 }),
      node(3, 1, 'second', { x: 90, y: 0, width: 100, height: 40 }),
    ]);
    const candidate = surface([
      node(20, -1, 'row', { x: 0, y: 0, width: 300, height: 100 }),
      node(21, 20, 'first', { x: 0, y: 0, width: 100, height: 40 }),
      node(22, 20, 'second', { x: 120, y: 0, width: 100, height: 40 }),
    ]);

    expect(compareStructuralSurfaces(baseline, candidate).changes).toContainEqual(
      expect.objectContaining({
        kind: 'sibling-overlap',
        direction: 'resolved',
        baselineState: 'overlap',
        candidateState: 'separate',
      }),
    );
  });

  it('reports newly introduced parent protrusion with evidence', () => {
    const baseline = surface([
      node(1, -1, 'card', { x: 0, y: 0, width: 200, height: 80 }),
      node(2, 1, 'cta', { x: 20, y: 20, width: 120, height: 30 }),
    ]);
    const candidate = surface([
      node(20, -1, 'card', { x: 0, y: 0, width: 200, height: 80 }),
      node(21, 20, 'cta', { x: 120, y: 20, width: 120, height: 30 }),
    ]);

    expect(compareStructuralSurfaces(baseline, candidate).changes).toContainEqual({
      kind: 'parent-containment',
      direction: 'introduced',
      viewport: { width: 768, height: 900 },
      parent: { key: 'id:card', quality: 'explicit', tagName: 'DIV' },
      subject: { key: 'id:cta', quality: 'explicit', tagName: 'DIV' },
      baselineState: 'contained',
      candidateState: 'protruding',
      baselineEvidence: {
        state: 'contained',
        sides: [],
        protrusionPx: { left: 0, right: 0, top: 0, bottom: 0 },
      },
      candidateEvidence: {
        state: 'protruding',
        sides: ['right'],
        protrusionPx: { left: 0, right: 40, top: 0, bottom: 0 },
      },
    });
  });

  it('does not report persistent overlap or persistent protrusion', () => {
    const baseline = surface([
      node(1, -1, 'row', { x: 0, y: 0, width: 180, height: 50 }),
      node(2, 1, 'first', { x: 0, y: 0, width: 100, height: 40 }),
      node(3, 1, 'second', { x: 90, y: 0, width: 100, height: 40 }),
    ]);
    const candidate = surface([
      node(20, -1, 'row', { x: 0, y: 0, width: 180, height: 50 }),
      node(21, 20, 'first', { x: 0, y: 0, width: 100, height: 40 }),
      node(22, 20, 'second', { x: 90, y: 0, width: 100, height: 40 }),
    ]);

    expect(compareStructuralSurfaces(baseline, candidate).changes).toEqual([]);
  });

  it('reports conservative reparenting when the child and both parents persist', () => {
    const baseline = surface([
      node(1, -1, 'left', { x: 0, y: 0, width: 200, height: 80 }),
      node(2, -1, 'right', { x: 250, y: 0, width: 200, height: 80 }),
      node(3, 1, 'cta', { x: 20, y: 20, width: 100, height: 30 }),
    ]);
    const candidate = surface([
      node(20, -1, 'left', { x: 0, y: 0, width: 200, height: 80 }),
      node(21, -1, 'right', { x: 250, y: 0, width: 200, height: 80 }),
      node(22, 21, 'cta', { x: 300, y: 20, width: 100, height: 30 }),
    ]);

    const changes = compareStructuralSurfaces(baseline, candidate).changes;

    expect(changes).toContainEqual({
      kind: 'reparenting',
      direction: 'introduced',
      viewport: { width: 768, height: 900 },
      subject: { key: 'id:cta', quality: 'explicit', tagName: 'DIV' },
      baselineParent: { key: 'id:left', quality: 'explicit', tagName: 'DIV' },
      candidateParent: { key: 'id:right', quality: 'explicit', tagName: 'DIV' },
    });
    expect(changes.filter((change) => change.kind === 'parent-containment')).toEqual([]);
  });

  it('reports disappearance as introduced and appearance as resolved evidence', () => {
    const baseline = surface([
      node(1, -1, 'root', { x: 0, y: 0, width: 300, height: 200 }),
      node(2, 1, 'checkout-button', { x: 20, y: 20, width: 120, height: 30 }),
    ]);
    const candidate = surface([
      node(20, -1, 'root', { x: 0, y: 0, width: 300, height: 200 }),
      node(21, 20, 'promo-badge', { x: 20, y: 20, width: 120, height: 30 }),
    ]);

    expect(compareStructuralSurfaces(baseline, candidate).changes).toEqual(
      expect.arrayContaining([
        {
          kind: 'node-presence',
          direction: 'introduced',
          viewport: { width: 768, height: 900 },
          subject: { key: 'id:checkout-button', quality: 'explicit', tagName: 'DIV' },
          baselineState: 'visible',
          candidateState: 'missing',
        },
        {
          kind: 'node-presence',
          direction: 'resolved',
          viewport: { width: 768, height: 900 },
          subject: { key: 'id:promo-badge', quality: 'explicit', tagName: 'DIV' },
          baselineState: 'missing',
          candidateState: 'visible',
        },
      ]),
    );
  });

  it('does not call an ambiguous duplicate identity disappeared', () => {
    const baseline = surface([
      node(1, -1, 'root', { x: 0, y: 0, width: 300, height: 200 }),
      node(2, 1, 'item', { x: 20, y: 20, width: 120, height: 30 }),
    ]);
    const candidate = surface([
      node(20, -1, 'root', { x: 0, y: 0, width: 300, height: 200 }),
      node(21, 20, 'item', { x: 20, y: 20, width: 120, height: 30 }),
      node(22, 20, 'item', { x: 20, y: 60, width: 120, height: 30 }),
    ]);

    expect(
      compareStructuralSurfaces(baseline, candidate).changes.filter(
        (change) => change.kind === 'node-presence',
      ),
    ).toEqual([]);
  });

  it('rejects different viewport sizes', () => {
    const baseline = surface([]);
    const candidate = {
      ...surface([]),
      viewport: { width: 390, height: 900 },
    };

    expect(() => compareStructuralSurfaces(baseline, candidate)).toThrow(
      'Cannot compare structural surfaces at different viewports',
    );
  });
});
