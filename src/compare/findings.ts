import { createHash } from 'node:crypto';
import type { CssSourceReference } from '../types.js';
import type { StructuralChangeDirection, StructuralSubject } from './structural-diff.js';
import type { StructuralChangeRange, StructuralRangeBoundary } from './ranges.js';

export type StructuralFindingType =
  | 'overlap'
  | 'protrusion'
  | 'reparenting'
  | 'disappearance'
  | 'appearance';

export interface StructuralFindingState {
  state: string;
  parent?: StructuralSubject;
}

export interface StructuralFindingRange {
  minWidth: number;
  maxWidth: number;
  widths: number[];
}

export interface StructuralFindingExactRange {
  minWidth?: number;
  maxWidth?: number;
}

export interface StructuralFinding {
  id: string;
  category: 'structural';
  type: StructuralFindingType;
  direction: StructuralChangeDirection;
  subject: StructuralSubject;
  relatedSubjects: StructuralSubject[];
  sampledRange: StructuralFindingRange;
  exactRange: StructuralFindingExactRange | null;
  baseline: StructuralFindingState;
  candidate: StructuralFindingState;
  source: CssSourceReference | null;
  evidence: {
    fingerprint: string;
    sampleCount: number;
    boundaries: StructuralRangeBoundary[];
  };
}

function exactRange(boundaries: StructuralRangeBoundary[]): StructuralFindingExactRange | null {
  const lower = boundaries.find((boundary) => boundary.edge === 'lower');
  const upper = boundaries.find((boundary) => boundary.edge === 'upper');

  if (!lower && !upper) return null;

  return {
    ...(lower ? { minWidth: lower.boundary } : {}),
    ...(upper ? { maxWidth: upper.boundary } : {}),
  };
}

function findingId(range: StructuralChangeRange): string {
  const exact = exactRange(range.boundaries);
  const lower = exact?.minWidth ?? `sample:${range.firstWidth}`;
  const upper = exact?.maxWidth ?? `sample:${range.lastWidth}`;
  const digest = createHash('sha256')
    .update(`${range.fingerprint}|${lower}|${upper}`)
    .digest('hex')
    .slice(0, 12);

  return `structural-${digest}`;
}

function findingFromRange(range: StructuralChangeRange): StructuralFinding {
  const common = {
    id: findingId(range),
    category: 'structural' as const,
    direction: range.direction,
    sampledRange: {
      minWidth: range.firstWidth,
      maxWidth: range.lastWidth,
      widths: [...range.sampleWidths],
    },
    exactRange: exactRange(range.boundaries),
    source: null,
    evidence: {
      fingerprint: range.fingerprint,
      sampleCount: range.sampleCount,
      boundaries: range.boundaries,
    },
  };

  switch (range.change.kind) {
    case 'sibling-overlap':
      return {
        ...common,
        type: 'overlap',
        subject: range.change.subjects[0],
        relatedSubjects: [range.change.subjects[1]],
        baseline: { state: range.change.baselineState },
        candidate: { state: range.change.candidateState },
      };
    case 'parent-containment':
      return {
        ...common,
        type: 'protrusion',
        subject: range.change.subject,
        relatedSubjects: [range.change.parent],
        baseline: {
          state: range.change.baselineState,
          parent: range.change.parent,
        },
        candidate: {
          state: range.change.candidateState,
          parent: range.change.parent,
        },
      };
    case 'reparenting':
      return {
        ...common,
        type: 'reparenting',
        subject: range.change.subject,
        relatedSubjects: [range.change.baselineParent, range.change.candidateParent],
        baseline: {
          state: 'parented',
          parent: range.change.baselineParent,
        },
        candidate: {
          state: 'parented',
          parent: range.change.candidateParent,
        },
      };
    case 'node-presence':
      return {
        ...common,
        type: range.change.candidateState === 'missing' ? 'disappearance' : 'appearance',
        subject: range.change.subject,
        relatedSubjects: [],
        baseline: { state: range.change.baselineState },
        candidate: { state: range.change.candidateState },
      };
  }
}

export function buildStructuralFindings(ranges: StructuralChangeRange[]): StructuralFinding[] {
  return ranges.map(findingFromRange);
}
