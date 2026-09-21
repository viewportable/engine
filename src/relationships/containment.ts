import type { SurfaceRect } from '../surface.js';

export const RELATIONSHIP_CONTAINMENT_TOLERANCE_PX = 1;

export type ContainmentSide = 'left' | 'right' | 'top' | 'bottom';
export type ContainmentRelationshipState = 'contained' | 'protruding';

export interface ContainmentRelationshipEvidence {
  state: ContainmentRelationshipState;
  sides: ContainmentSide[];
  protrusionPx: {
    left: number;
    right: number;
    top: number;
    bottom: number;
  };
}

export function containmentRelationshipEvidence(
  parent: SurfaceRect,
  child: SurfaceRect,
): ContainmentRelationshipEvidence {
  const raw = {
    left: parent.x - child.x,
    right: child.x + child.width - (parent.x + parent.width),
    top: parent.y - child.y,
    bottom: child.y + child.height - (parent.y + parent.height),
  };

  const protrusionPx = {
    left:
      raw.left > RELATIONSHIP_CONTAINMENT_TOLERANCE_PX ? Math.round(raw.left) : 0,
    right:
      raw.right > RELATIONSHIP_CONTAINMENT_TOLERANCE_PX ? Math.round(raw.right) : 0,
    top: raw.top > RELATIONSHIP_CONTAINMENT_TOLERANCE_PX ? Math.round(raw.top) : 0,
    bottom:
      raw.bottom > RELATIONSHIP_CONTAINMENT_TOLERANCE_PX ? Math.round(raw.bottom) : 0,
  };

  const sides = (['left', 'right', 'top', 'bottom'] as const).filter(
    (side) => protrusionPx[side] > 0,
  );

  return {
    state: sides.length > 0 ? 'protruding' : 'contained',
    sides,
    protrusionPx,
  };
}

export function containmentRelationshipState(
  parent: SurfaceRect,
  child: SurfaceRect,
): ContainmentRelationshipState {
  return containmentRelationshipEvidence(parent, child).state;
}
