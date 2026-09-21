import {
  buildRelationshipIntervals,
  findSandwichedRelationshipIntervals,
  type RelationshipInterval,
} from '../relationships/intervals.js';
import {
  overlapRelationshipState,
  type OverlapRelationshipState,
} from '../relationships/overlap.js';
import type { LayoutNode } from '../types.js';

export interface SmallRangeOverlapSample {
  width: number;
  nodes: LayoutNode[];
}

export interface SmallRangeOverlapCandidate {
  parentIdentity: string;
  firstIdentity: string;
  secondIdentity: string;
  interval: RelationshipInterval<OverlapRelationshipState>;
  sampledSpanPx: number;
}

interface PairObservation {
  parentIdentity: string;
  firstIdentity: string;
  secondIdentity: string;
  samples: Array<{ width: number; state: OverlapRelationshipState }>;
}

function stableIdentity(node: LayoutNode): string | null {
  return node.identity ?? null;
}

function pairKey(parentIdentity: string, firstIdentity: string, secondIdentity: string): string {
  const [left, right] = [firstIdentity, secondIdentity].sort();
  return `${parentIdentity}|${left}|${right}`;
}

export function detectSmallRangeOverlapCandidates(
  samples: SmallRangeOverlapSample[],
): SmallRangeOverlapCandidate[] {
  const widths = [...new Set(samples.map((sample) => sample.width))].sort(
    (first, second) => first - second,
  );
  if (widths.length < 3) return [];

  const pairs = new Map<string, PairObservation>();

  for (const sample of samples) {
    const nodesByIndex = new Map(sample.nodes.map((node) => [node.index, node]));
    const childrenByParent = new Map<string, LayoutNode[]>();

    for (const node of sample.nodes) {
      const identity = stableIdentity(node);
      if (!identity || node.parentIndex === -1 || !node.isVisible) continue;

      const parent = nodesByIndex.get(node.parentIndex);
      const parentIdentity = parent ? stableIdentity(parent) : null;
      if (!parentIdentity) continue;

      const children = childrenByParent.get(parentIdentity) ?? [];
      children.push(node);
      childrenByParent.set(parentIdentity, children);
    }

    for (const [parentIdentity, children] of childrenByParent) {
      for (let firstIndex = 0; firstIndex < children.length; firstIndex += 1) {
        const first = children[firstIndex];
        const firstIdentity = first ? stableIdentity(first) : null;
        if (!first || !firstIdentity) continue;

        for (let secondIndex = firstIndex + 1; secondIndex < children.length; secondIndex += 1) {
          const second = children[secondIndex];
          const secondIdentity = second ? stableIdentity(second) : null;
          if (!second || !secondIdentity) continue;

          const key = pairKey(parentIdentity, firstIdentity, secondIdentity);
          const [orderedFirst, orderedSecond] = [firstIdentity, secondIdentity].sort();
          const observation = pairs.get(key) ?? {
            parentIdentity,
            firstIdentity: orderedFirst ?? firstIdentity,
            secondIdentity: orderedSecond ?? secondIdentity,
            samples: [],
          };

          observation.samples.push({
            width: sample.width,
            state: overlapRelationshipState(first.rect, second.rect),
          });
          pairs.set(key, observation);
        }
      }
    }
  }

  const candidates: SmallRangeOverlapCandidate[] = [];

  for (const observation of pairs.values()) {
    const observedWidths = new Set(observation.samples.map((sample) => sample.width));
    if (widths.some((width) => !observedWidths.has(width))) continue;

    const intervals = buildRelationshipIntervals(observation.samples);

    for (const candidate of findSandwichedRelationshipIntervals(intervals)) {
      if (candidate.interval.state !== 'overlap' || candidate.surroundingState !== 'separate') {
        continue;
      }

      candidates.push({
        parentIdentity: observation.parentIdentity,
        firstIdentity: observation.firstIdentity,
        secondIdentity: observation.secondIdentity,
        interval: candidate.interval,
        sampledSpanPx: candidate.sampledSpanPx,
      });
    }
  }

  return candidates;
}
