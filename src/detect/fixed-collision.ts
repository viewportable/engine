import type { Detector } from '../detector.js';
import type { LayoutNode, Viewport } from '../types.js';

export const COLLISION_TOLERANCE_PX = 1;

export interface FixedCollisionFinding {
  firstNodeIndex: number;
  secondNodeIndex: number;
  overlapWidthPx: number;
  overlapHeightPx: number;
  overlapAreaPx: number;
  firstBbox: [number, number, number, number];
  secondBbox: [number, number, number, number];
}

function ancestorsOf(node: LayoutNode, nodesByIndex: Map<number, LayoutNode>): LayoutNode[] {
  const ancestors: LayoutNode[] = [];
  const seen = new Set<number>();
  let currentIndex = node.parentIndex;

  while (currentIndex !== -1 && !seen.has(currentIndex)) {
    seen.add(currentIndex);
    const current = nodesByIndex.get(currentIndex);
    if (!current) break;
    ancestors.push(current);
    currentIndex = current.parentIndex;
  }

  return ancestors;
}

function isAncestorOf(
  ancestor: LayoutNode,
  descendant: LayoutNode,
  nodesByIndex: Map<number, LayoutNode>,
): boolean {
  return ancestorsOf(descendant, nodesByIndex).some((node) => node.index === ancestor.index);
}

function isAriaHidden(node: LayoutNode, nodesByIndex: Map<number, LayoutNode>): boolean {
  if (node.attributes['aria-hidden']?.toLowerCase() === 'true') return true;

  return ancestorsOf(node, nodesByIndex).some(
    (ancestor) => ancestor.attributes['aria-hidden']?.toLowerCase() === 'true',
  );
}

function isEffectivelyTransparent(
  node: LayoutNode,
  nodesByIndex: Map<number, LayoutNode>,
): boolean {
  const transparent = (candidate: LayoutNode): boolean => {
    const opacity = Number(candidate.styles.opacity);
    return Number.isFinite(opacity) && opacity <= 0.01;
  };

  return transparent(node) || ancestorsOf(node, nodesByIndex).some(transparent);
}

function intersectsViewport(node: LayoutNode, viewport: Viewport): boolean {
  const right = node.rect.x + node.rect.width;
  const bottom = node.rect.y + node.rect.height;

  return (
    right > COLLISION_TOLERANCE_PX &&
    bottom > COLLISION_TOLERANCE_PX &&
    node.rect.x < viewport.width - COLLISION_TOLERANCE_PX &&
    node.rect.y < viewport.height - COLLISION_TOLERANCE_PX
  );
}

function coversViewport(node: LayoutNode, viewport: Viewport): boolean {
  const right = node.rect.x + node.rect.width;
  const bottom = node.rect.y + node.rect.height;

  return (
    node.rect.x <= COLLISION_TOLERANCE_PX &&
    node.rect.y <= COLLISION_TOLERANCE_PX &&
    right >= viewport.width - COLLISION_TOLERANCE_PX &&
    bottom >= viewport.height - COLLISION_TOLERANCE_PX
  );
}

function bbox(node: LayoutNode): [number, number, number, number] {
  return [node.rect.x, node.rect.y, node.rect.width, node.rect.height];
}

export function detectFixedElementCollisions(
  nodes: LayoutNode[],
  viewport: Viewport,
): FixedCollisionFinding[] {
  const nodesByIndex = new Map(nodes.map((node) => [node.index, node]));
  const candidates = nodes.filter((node) => {
    if (node.tagName === 'HTML' || node.tagName === 'BODY') return false;
    if (node.styles.position?.toLowerCase() !== 'fixed') return false;
    if (isAriaHidden(node, nodesByIndex)) return false;
    if (isEffectivelyTransparent(node, nodesByIndex)) return false;
    if (!intersectsViewport(node, viewport)) return false;
    if (coversViewport(node, viewport)) return false;
    return true;
  });

  const findings: FixedCollisionFinding[] = [];

  for (let firstIndex = 0; firstIndex < candidates.length; firstIndex += 1) {
    const first = candidates[firstIndex];
    if (!first) continue;

    for (let secondIndex = firstIndex + 1; secondIndex < candidates.length; secondIndex += 1) {
      const second = candidates[secondIndex];
      if (!second) continue;

      if (isAncestorOf(first, second, nodesByIndex) || isAncestorOf(second, first, nodesByIndex)) {
        continue;
      }

      const left = Math.max(first.rect.x, second.rect.x);
      const top = Math.max(first.rect.y, second.rect.y);
      const right = Math.min(first.rect.x + first.rect.width, second.rect.x + second.rect.width);
      const bottom = Math.min(first.rect.y + first.rect.height, second.rect.y + second.rect.height);
      const overlapWidth = right - left;
      const overlapHeight = bottom - top;

      if (overlapWidth <= COLLISION_TOLERANCE_PX || overlapHeight <= COLLISION_TOLERANCE_PX) {
        continue;
      }

      const overlapWidthPx = Math.round(overlapWidth);
      const overlapHeightPx = Math.round(overlapHeight);

      findings.push({
        firstNodeIndex: first.index,
        secondNodeIndex: second.index,
        overlapWidthPx,
        overlapHeightPx,
        overlapAreaPx: overlapWidthPx * overlapHeightPx,
        firstBbox: bbox(first),
        secondBbox: bbox(second),
      });
    }
  }

  return findings;
}

export const fixedElementCollisionDetector: Detector<FixedCollisionFinding, LayoutNode> = {
  id: 'fixed-element-collision',
  requires: ['geometry', 'computed-styles', 'tree'],
  detect: ({ surface }) => detectFixedElementCollisions(surface.nodes, surface.viewport),
};
