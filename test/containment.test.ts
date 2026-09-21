import { describe, expect, it } from 'vitest';
import {
  containmentRelationshipEvidence,
  containmentRelationshipState,
} from '../src/relationships/containment.js';

describe('containment relationships', () => {
  it('treats a 1px edge difference as contained', () => {
    expect(
      containmentRelationshipState(
        { x: 0, y: 0, width: 100, height: 50 },
        { x: 0, y: 0, width: 101, height: 50 },
      ),
    ).toBe('contained');
  });

  it('reports protruding sides and pixels', () => {
    expect(
      containmentRelationshipEvidence(
        { x: 10, y: 10, width: 100, height: 50 },
        { x: 5, y: 12, width: 120, height: 60 },
      ),
    ).toEqual({
      state: 'protruding',
      sides: ['left', 'right', 'bottom'],
      protrusionPx: {
        left: 5,
        right: 15,
        top: 0,
        bottom: 12,
      },
    });
  });
});
