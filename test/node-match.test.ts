import { describe, expect, it } from 'vitest';
import { matchCrossVersionNodes } from '../src/compare/node-match.js';
import type { LayoutNode } from '../src/types.js';

function node(
  index: number,
  parentIndex: number,
  overrides: Partial<LayoutNode> = {},
): LayoutNode {
  return {
    index,
    parentIndex,
    identity: `session:${index}`,
    tagName: 'DIV',
    attributes: {},
    rect: { x: 0, y: 0, width: 100, height: 20 },
    styles: {},
    paintOrder: index,
    isVisible: true,
    nthChild: 1,
    ...overrides,
  };
}

describe('matchCrossVersionNodes', () => {
  it('matches stable ids across different runtime identities and indices', () => {
    const baseline = [
      node(10, -1, {
        identity: 'web:100',
        tagName: 'BUTTON',
        attributes: { id: 'checkout' },
      }),
    ];
    const candidate = [
      node(44, -1, {
        identity: 'web:900',
        tagName: 'BUTTON',
        attributes: { id: 'checkout' },
      }),
    ];

    const result = matchCrossVersionNodes(baseline, candidate);

    expect(result.matches).toEqual([
      expect.objectContaining({
        key: 'id:checkout',
        quality: 'explicit',
        baseline: expect.objectContaining({ index: 10, identity: 'web:100' }),
        candidate: expect.objectContaining({ index: 44, identity: 'web:900' }),
      }),
    ]);
  });

  it('matches explicit test attributes without relying on browser node ids', () => {
    const baseline = [
      node(1, -1, {
        identity: 'web:1',
        tagName: 'A',
        attributes: { 'data-testid': 'pricing-cta' },
      }),
    ];
    const candidate = [
      node(99, -1, {
        identity: 'web:99',
        tagName: 'BUTTON',
        attributes: { 'data-testid': 'pricing-cta' },
      }),
    ];

    expect(matchCrossVersionNodes(baseline, candidate).matches[0]).toMatchObject({
      key: 'data-testid:pricing-cta',
      quality: 'explicit',
    });
  });

  it('uses a structural path when no explicit identity exists', () => {
    const baseline = [
      node(1, -1, {
        tagName: 'MAIN',
        attributes: { class: 'checkout' },
      }),
      node(2, 1, {
        tagName: 'BUTTON',
        attributes: { class: 'primary' },
        nthChild: 2,
      }),
    ];
    const candidate = [
      node(20, -1, {
        tagName: 'MAIN',
        attributes: { class: 'checkout' },
      }),
      node(21, 20, {
        tagName: 'BUTTON',
        attributes: { class: 'primary' },
        nthChild: 2,
      }),
    ];

    const result = matchCrossVersionNodes(baseline, candidate);
    const button = result.matches.find((match) => match.candidate.tagName === 'BUTTON');

    expect(button).toMatchObject({
      quality: 'structural',
      key: 'path:main.checkout:nth-child(1)>button.primary:nth-child(2)',
    });
  });

  it('does not match duplicate explicit keys within a snapshot', () => {
    const baseline = [
      node(1, -1, { attributes: { 'data-testid': 'item' } }),
      node(2, -1, { attributes: { 'data-testid': 'item' } }),
    ];
    const candidate = [node(3, -1, { attributes: { 'data-testid': 'item' } })];

    expect(matchCrossVersionNodes(baseline, candidate).matches).toEqual([]);
  });
});
