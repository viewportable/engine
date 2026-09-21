import { describe, expect, it } from 'vitest';
import { groupWrappingIssues } from '../src/analyze/wrapping-group.js';
import { assessWrappingReflow } from '../src/analyze/wrapping-reflow.js';
import { detectWrappingTransitions } from '../src/analyze/wrapping.js';
import type { LayoutNode, WrappingIssue } from '../src/types.js';

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
    tagName: 'A',
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

function surface(
  width: number,
  positions: Array<[number, number]>,
): { width: number; nodes: LayoutNode[] } {
  return {
    width,
    nodes: [
      node(1, -1, 0, 0, width, 120),
      ...positions.map(([x, y], offset) => node(offset + 2, 1, x, y)),
    ],
  };
}

function identifiedSurface(
  width: number,
  indexOffset: number,
  positions: Array<[number, number]>,
): { width: number; nodes: LayoutNode[] } {
  const parent = node(1 + indexOffset, -1, 0, 0, width, 120);
  parent.identity = 'parent';

  const children = positions.map(([x, y], offset) => {
    const child = node(offset + 2 + indexOffset, parent.index, x, y);
    child.identity = `item-${offset + 1}`;
    return child;
  });

  return { width, nodes: [parent, ...children] };
}

describe('detectWrappingTransitions', () => {
  it('detects one sibling dropping out of a previously stable row', () => {
    const findings = detectWrappingTransitions([
      surface(430, [
        [0, 10],
        [90, 10],
        [180, 10],
        [270, 10],
      ]),
      surface(320, [
        [0, 10],
        [90, 10],
        [180, 10],
        [0, 50],
      ]),
    ]);

    expect(findings).toEqual([
      expect.objectContaining({
        nodeIndex: 5,
        parentIndex: 1,
        viewportWidth: 320,
        previousViewportWidth: 430,
        previousRowSize: 4,
        currentRowSize: 1,
        stableSiblingCount: 3,
        verticalShiftPx: 40,
      }),
    ]);
  });

  it('matches elements by stable identity when snapshot indices change', () => {
    const findings = detectWrappingTransitions([
      identifiedSurface(430, 0, [
        [0, 10],
        [90, 10],
        [180, 10],
        [270, 10],
      ]),
      identifiedSurface(320, 100, [
        [0, 10],
        [90, 10],
        [180, 10],
        [0, 50],
      ]),
    ]);

    expect(findings).toEqual([
      expect.objectContaining({
        nodeIndex: 105,
        parentIndex: 101,
        viewportWidth: 320,
        stableSiblingCount: 3,
      }),
    ]);
  });

  it('does not flag balanced responsive reflow', () => {
    const findings = detectWrappingTransitions([
      surface(430, [
        [0, 10],
        [90, 10],
        [180, 10],
        [270, 10],
      ]),
      surface(320, [
        [0, 10],
        [90, 10],
        [0, 50],
        [90, 50],
      ]),
    ]);

    expect(findings).toEqual([]);
  });

  it('does not flag a row that remains stable across widths', () => {
    const findings = detectWrappingTransitions([
      surface(430, [
        [0, 10],
        [90, 10],
        [180, 10],
      ]),
      surface(320, [
        [0, 10],
        [90, 10],
        [180, 10],
      ]),
    ]);

    expect(findings).toEqual([]);
  });
});

function wrappingIssue(
  id: string,
  selector: string,
  viewportWidth: number,
  previousViewportWidth: number,
  parentDisplay = 'block',
  parentFlexWrap = 'nowrap',
): WrappingIssue {
  return {
    id,
    type: 'wrapping',
    severity: 'error',
    selector,
    parentSelector: '#footer-links',
    tagName: 'LI',
    parentTagName: 'UL',
    viewportWidth,
    previousViewportWidth,
    bbox: [0, 40, 80, 30],
    evidence: {
      previousRowSize: 5,
      currentRowSize: 1,
      stableSiblingCount: 4,
      previousRowIndex: 0,
      currentRowIndex: 1,
      verticalShiftPx: 40,
      parentDisplay,
      parentFlexWrap,
    },
  };
}

describe('groupWrappingIssues', () => {
  it('groups sibling observations under one parent finding', () => {
    const groups = groupWrappingIssues([
      wrappingIssue('issue-1', '#terms', 390, 430, 'flex', 'wrap'),
      wrappingIssue('issue-2', '#privacy', 390, 430, 'flex', 'wrap'),
    ]);

    expect(groups).toEqual([
      expect.objectContaining({
        parentSelector: '#footer-links',
        issueIds: ['issue-1', 'issue-2'],
        observations: [
          expect.objectContaining({
            viewportWidth: 390,
            previousViewportWidth: 430,
            issueIds: ['issue-1', 'issue-2'],
            wrappedSelectors: ['#terms', '#privacy'],
            stableSiblingCount: 4,
            wrappedSiblingCount: 2,
          }),
        ],
        evidence: {
          authoredFlexWrap: true,
          transitionCount: 1,
          repeatedAcrossWidths: false,
          displayValues: ['flex'],
          flexWrapValues: ['wrap'],
        },
      }),
    ]);
  });

  it('records repeated responsive reflow as evidence without declaring intent', () => {
    const groups = groupWrappingIssues([
      wrappingIssue('issue-1', '#terms', 390, 430),
      wrappingIssue('issue-2', '#privacy', 320, 390),
    ]);

    expect(groups[0]?.evidence).toEqual({
      authoredFlexWrap: false,
      transitionCount: 2,
      repeatedAcrossWidths: true,
      displayValues: ['block'],
      flexWrapValues: ['nowrap'],
    });
    expect(groups[0]?.observations).toHaveLength(2);
  });
});

describe('assessWrappingReflow', () => {
  it('marks explicit flex wrapping as a review candidate without suppressing it', () => {
    expect(
      assessWrappingReflow({
        authoredFlexWrap: true,
        repeatedAcrossWidths: false,
      }),
    ).toEqual({
      classification: 'authored-reflow-candidate',
      reasons: ['explicit-flex-wrap'],
    });
  });

  it('does not classify repeated wrapping by itself as intentional', () => {
    expect(
      assessWrappingReflow({
        authoredFlexWrap: false,
        repeatedAcrossWidths: true,
      }),
    ).toEqual({
      classification: 'unclassified',
      reasons: [],
    });
  });
});
