import type { LayoutNode } from '../types.js';

export const ELEMENT_PROTRUSION_TOLERANCE_PX = 1;

export interface ElementProtrusionCandidate {
  viewportWidth: number;
  parentIdentity: string;
  parentLabel: string;
  childIdentity: string;
  childLabel: string;
  sides: Array<'left' | 'right' | 'top' | 'bottom'>;
  protrusionPx: {
    left: number;
    right: number;
    top: number;
    bottom: number;
  };
  parentBbox: [number, number, number, number];
  childBbox: [number, number, number, number];
  evidence: {
    parentDisplay: string;
    parentOverflow: string;
    parentOverflowX: string;
    parentOverflowY: string;
    childPosition: string;
  };
}

function nodeLabel(node: LayoutNode): string {
  const id = node.attributes.id ? `#${node.attributes.id}` : '';
  const classes = node.attributes.class
    ? `.${node.attributes.class.split(/\s+/).filter(Boolean).slice(0, 3).join('.')}`
    : '';

  return `${node.tagName.toLowerCase()}${id}${classes}`;
}

function hasTranslatedTransform(node: LayoutNode): boolean {
  const transform = node.styles.transform?.trim().toLowerCase();
  return Boolean(transform && transform !== 'none');
}

export function detectElementProtrusionCandidates(
  nodes: LayoutNode[],
  viewportWidth: number,
): ElementProtrusionCandidate[] {
  const nodesByIndex = new Map(nodes.map((node) => [node.index, node]));
  const candidates: ElementProtrusionCandidate[] = [];

  for (const child of nodes) {
    if (!child.isVisible || child.parentIndex === -1) continue;
    if (!child.identity) continue;
    if (child.styles.position?.toLowerCase() === 'fixed') continue;
    if (child.attributes['aria-hidden']?.toLowerCase() === 'true') continue;
    if (hasTranslatedTransform(child)) continue;

    const parent = nodesByIndex.get(child.parentIndex);
    if (!parent?.isVisible || !parent.identity) continue;
    if (parent.tagName === 'HTML' || parent.tagName === 'BODY') continue;
    if (parent.attributes['aria-hidden']?.toLowerCase() === 'true') continue;
    if (hasTranslatedTransform(parent)) continue;

    const left = parent.rect.x - child.rect.x;
    const right =
      child.rect.x + child.rect.width - (parent.rect.x + parent.rect.width);
    const top = parent.rect.y - child.rect.y;
    const bottom =
      child.rect.y + child.rect.height - (parent.rect.y + parent.rect.height);

    const protrusionPx = {
      left: left > ELEMENT_PROTRUSION_TOLERANCE_PX ? Math.round(left) : 0,
      right: right > ELEMENT_PROTRUSION_TOLERANCE_PX ? Math.round(right) : 0,
      top: top > ELEMENT_PROTRUSION_TOLERANCE_PX ? Math.round(top) : 0,
      bottom: bottom > ELEMENT_PROTRUSION_TOLERANCE_PX ? Math.round(bottom) : 0,
    };

    const sides = (['left', 'right', 'top', 'bottom'] as const).filter(
      (side) => protrusionPx[side] > 0,
    );
    if (sides.length === 0) continue;

    candidates.push({
      viewportWidth,
      parentIdentity: parent.identity,
      parentLabel: nodeLabel(parent),
      childIdentity: child.identity,
      childLabel: nodeLabel(child),
      sides,
      protrusionPx,
      parentBbox: [parent.rect.x, parent.rect.y, parent.rect.width, parent.rect.height],
      childBbox: [child.rect.x, child.rect.y, child.rect.width, child.rect.height],
      evidence: {
        parentDisplay: parent.styles.display ?? '',
        parentOverflow: parent.styles.overflow ?? '',
        parentOverflowX: parent.styles['overflow-x'] ?? '',
        parentOverflowY: parent.styles['overflow-y'] ?? '',
        childPosition: child.styles.position ?? '',
      },
    });
  }

  return candidates;
}
