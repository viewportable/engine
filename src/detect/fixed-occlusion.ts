import type { Detector } from '../detector.js';
import type { LayoutNode, Viewport } from '../types.js';

export const OCCLUSION_TOLERANCE_PX = 1;
export const MIN_TARGET_COVERAGE = 0.2;

const INTERACTIVE_ROLES = new Set([
  'button',
  'checkbox',
  'link',
  'menuitem',
  'radio',
  'switch',
  'tab',
]);

export interface FixedContentOcclusionFinding {
  occluderNodeIndex: number;
  targetNodeIndex: number;
  overlapWidthPx: number;
  overlapHeightPx: number;
  overlapAreaPx: number;
  targetCoveragePct: number;
  occluderBbox: [number, number, number, number];
  targetBbox: [number, number, number, number];
  occluderPaintOrder: number;
  targetPaintOrder: number;
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

function hasPointerEvents(node: LayoutNode, nodesByIndex: Map<number, LayoutNode>): boolean {
  const blocked = (candidate: LayoutNode): boolean =>
    candidate.styles['pointer-events']?.toLowerCase() === 'none';

  return !blocked(node) && !ancestorsOf(node, nodesByIndex).some(blocked);
}

function hasScrollableAncestor(node: LayoutNode, nodesByIndex: Map<number, LayoutNode>): boolean {
  return ancestorsOf(node, nodesByIndex).some((ancestor) => {
    const overflow = ancestor.styles.overflow?.toLowerCase();
    const overflowY = ancestor.styles['overflow-y']?.toLowerCase();
    return (
      overflow === 'auto' || overflow === 'scroll' || overflowY === 'auto' || overflowY === 'scroll'
    );
  });
}

function intersectsViewport(node: LayoutNode, viewport: Viewport): boolean {
  const right = node.rect.x + node.rect.width;
  const bottom = node.rect.y + node.rect.height;

  return (
    right > OCCLUSION_TOLERANCE_PX &&
    bottom > OCCLUSION_TOLERANCE_PX &&
    node.rect.x < viewport.width - OCCLUSION_TOLERANCE_PX &&
    node.rect.y < viewport.height - OCCLUSION_TOLERANCE_PX
  );
}

function coversViewport(node: LayoutNode, viewport: Viewport): boolean {
  const right = node.rect.x + node.rect.width;
  const bottom = node.rect.y + node.rect.height;

  return (
    node.rect.x <= OCCLUSION_TOLERANCE_PX &&
    node.rect.y <= OCCLUSION_TOLERANCE_PX &&
    right >= viewport.width - OCCLUSION_TOLERANCE_PX &&
    bottom >= viewport.height - OCCLUSION_TOLERANCE_PX
  );
}

function isInteractive(node: LayoutNode): boolean {
  if ('disabled' in node.attributes) return false;
  if (node.attributes['aria-disabled']?.toLowerCase() === 'true') return false;

  if (node.tagName === 'BUTTON' || node.tagName === 'SELECT' || node.tagName === 'TEXTAREA') {
    return true;
  }

  if (node.tagName === 'A') {
    return Boolean(node.attributes.href);
  }

  if (node.tagName === 'INPUT') {
    return node.attributes.type?.toLowerCase() !== 'hidden';
  }

  if (node.attributes.contenteditable?.toLowerCase() === 'true') {
    return true;
  }

  return INTERACTIVE_ROLES.has(node.attributes.role?.toLowerCase() ?? '');
}

function bbox(node: LayoutNode): [number, number, number, number] {
  return [node.rect.x, node.rect.y, node.rect.width, node.rect.height];
}

function visibleArea(node: LayoutNode, viewport: Viewport): number {
  const left = Math.max(node.rect.x, 0);
  const top = Math.max(node.rect.y, 0);
  const right = Math.min(node.rect.x + node.rect.width, viewport.width);
  const bottom = Math.min(node.rect.y + node.rect.height, viewport.height);

  return Math.max(0, right - left) * Math.max(0, bottom - top);
}

export function detectFixedContentOcclusions(
  nodes: LayoutNode[],
  viewport: Viewport,
): FixedContentOcclusionFinding[] {
  const nodesByIndex = new Map(nodes.map((node) => [node.index, node]));
  const occluders = nodes.filter((node) => {
    if (node.tagName === 'HTML' || node.tagName === 'BODY') return false;
    if (node.styles.position?.toLowerCase() !== 'fixed') return false;
    if (isAriaHidden(node, nodesByIndex)) return false;
    if (isEffectivelyTransparent(node, nodesByIndex)) return false;
    if (!hasPointerEvents(node, nodesByIndex)) return false;
    if (!intersectsViewport(node, viewport)) return false;
    if (coversViewport(node, viewport)) return false;
    return true;
  });
  const targets = nodes.filter((node) => {
    if (!isInteractive(node)) return false;
    if (node.styles.position?.toLowerCase() === 'fixed') return false;
    if (isAriaHidden(node, nodesByIndex)) return false;
    if (isEffectivelyTransparent(node, nodesByIndex)) return false;
    if (!hasPointerEvents(node, nodesByIndex)) return false;
    if (hasScrollableAncestor(node, nodesByIndex)) return false;
    if (!intersectsViewport(node, viewport)) return false;
    return true;
  });

  const findings: FixedContentOcclusionFinding[] = [];

  for (const occluder of occluders) {
    for (const target of targets) {
      if (
        isAncestorOf(occluder, target, nodesByIndex) ||
        isAncestorOf(target, occluder, nodesByIndex)
      ) {
        continue;
      }

      if (occluder.paintOrder <= target.paintOrder) continue;

      const left = Math.max(occluder.rect.x, target.rect.x, 0);
      const top = Math.max(occluder.rect.y, target.rect.y, 0);
      const right = Math.min(
        occluder.rect.x + occluder.rect.width,
        target.rect.x + target.rect.width,
        viewport.width,
      );
      const bottom = Math.min(
        occluder.rect.y + occluder.rect.height,
        target.rect.y + target.rect.height,
        viewport.height,
      );
      const overlapWidth = right - left;
      const overlapHeight = bottom - top;

      if (overlapWidth <= OCCLUSION_TOLERANCE_PX || overlapHeight <= OCCLUSION_TOLERANCE_PX) {
        continue;
      }

      const targetVisibleArea = visibleArea(target, viewport);
      if (targetVisibleArea <= 0) continue;

      const overlapArea = overlapWidth * overlapHeight;
      const coverage = overlapArea / targetVisibleArea;
      if (coverage < MIN_TARGET_COVERAGE) continue;

      const overlapWidthPx = Math.round(overlapWidth);
      const overlapHeightPx = Math.round(overlapHeight);

      findings.push({
        occluderNodeIndex: occluder.index,
        targetNodeIndex: target.index,
        overlapWidthPx,
        overlapHeightPx,
        overlapAreaPx: overlapWidthPx * overlapHeightPx,
        targetCoveragePct: Math.min(100, Math.round(coverage * 100)),
        occluderBbox: bbox(occluder),
        targetBbox: bbox(target),
        occluderPaintOrder: occluder.paintOrder,
        targetPaintOrder: target.paintOrder,
      });
    }
  }

  return findings;
}

export const fixedContentOcclusionDetector: Detector<FixedContentOcclusionFinding, LayoutNode> = {
  id: 'fixed-content-occlusion',
  requires: ['geometry', 'computed-styles', 'paint-order', 'tree'],
  detect: ({ surface }) => detectFixedContentOcclusions(surface.nodes, surface.viewport),
};
