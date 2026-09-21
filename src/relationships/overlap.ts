import type { SurfaceRect } from '../surface.js';

export const RELATIONSHIP_OVERLAP_TOLERANCE_PX = 1;

export type OverlapRelationshipState = 'separate' | 'overlap';

export function overlapRelationshipState(
  first: SurfaceRect,
  second: SurfaceRect,
): OverlapRelationshipState {
  const left = Math.max(first.x, second.x);
  const top = Math.max(first.y, second.y);
  const right = Math.min(first.x + first.width, second.x + second.width);
  const bottom = Math.min(first.y + first.height, second.y + second.height);

  const overlapWidth = right - left;
  const overlapHeight = bottom - top;

  return overlapWidth > RELATIONSHIP_OVERLAP_TOLERANCE_PX &&
    overlapHeight > RELATIONSHIP_OVERLAP_TOLERANCE_PX
    ? 'overlap'
    : 'separate';
}
