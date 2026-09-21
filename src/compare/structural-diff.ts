import type { SurfaceSnapshot } from '../surface.js';
import type { LayoutNode } from '../types.js';
import {
  containmentRelationshipEvidence,
  type ContainmentRelationshipEvidence,
  type ContainmentRelationshipState,
} from '../relationships/containment.js';
import {
  overlapRelationshipState,
  type OverlapRelationshipState,
} from '../relationships/overlap.js';
import {
  matchCrossVersionNodes,
  type CrossVersionMatchQuality,
  type CrossVersionNodeIndexEntry,
  type CrossVersionNodeMatch,
  type CrossVersionNodeMatchResult,
} from './node-match.js';

export type StructuralChangeDirection = 'introduced' | 'resolved';
export type StructuralPresenceState = 'visible' | 'missing';

export interface StructuralSubject {
  key: string;
  quality: CrossVersionMatchQuality;
  tagName: string;
}

export interface SiblingOverlapStructuralChange {
  kind: 'sibling-overlap';
  direction: StructuralChangeDirection;
  viewport: { width: number; height: number };
  parent: StructuralSubject;
  subjects: [StructuralSubject, StructuralSubject];
  baselineState: OverlapRelationshipState;
  candidateState: OverlapRelationshipState;
}

export interface ParentContainmentStructuralChange {
  kind: 'parent-containment';
  direction: StructuralChangeDirection;
  viewport: { width: number; height: number };
  parent: StructuralSubject;
  subject: StructuralSubject;
  baselineState: ContainmentRelationshipState;
  candidateState: ContainmentRelationshipState;
  baselineEvidence: ContainmentRelationshipEvidence;
  candidateEvidence: ContainmentRelationshipEvidence;
}

export interface ReparentingStructuralChange {
  kind: 'reparenting';
  direction: 'introduced';
  viewport: { width: number; height: number };
  subject: StructuralSubject;
  baselineParent: StructuralSubject;
  candidateParent: StructuralSubject;
}

export interface NodePresenceStructuralChange {
  kind: 'node-presence';
  direction: StructuralChangeDirection;
  viewport: { width: number; height: number };
  subject: StructuralSubject;
  baselineState: StructuralPresenceState;
  candidateState: StructuralPresenceState;
}

export type StructuralChange =
  | SiblingOverlapStructuralChange
  | ParentContainmentStructuralChange
  | ReparentingStructuralChange
  | NodePresenceStructuralChange;

export interface StructuralDiff {
  platform: SurfaceSnapshot['platform'];
  viewport: { width: number; height: number };
  matchedNodes: number;
  changes: StructuralChange[];
}

function subject(match: CrossVersionNodeMatch): StructuralSubject {
  return {
    key: match.key,
    quality: match.quality,
    tagName: match.candidate.tagName,
  };
}

function indexedSubject(entry: CrossVersionNodeIndexEntry): StructuralSubject {
  return {
    key: entry.key,
    quality: entry.quality,
    tagName: entry.node.tagName,
  };
}

function direction(
  baselineState: 'separate' | 'overlap' | 'contained' | 'protruding',
  candidateState: 'separate' | 'overlap' | 'contained' | 'protruding',
): StructuralChangeDirection {
  const candidateBad = candidateState === 'overlap' || candidateState === 'protruding';
  const baselineBad = baselineState === 'overlap' || baselineState === 'protruding';

  if (!baselineBad && candidateBad) return 'introduced';
  return 'resolved';
}

function comparableContainmentNode(node: LayoutNode): boolean {
  const position = node.styles.position?.toLowerCase();
  const transform = node.styles.transform?.trim().toLowerCase();

  if (!node.isVisible) return false;
  if (position === 'fixed') return false;
  if (transform && transform !== 'none') return false;
  if (node.attributes['aria-hidden']?.toLowerCase() === 'true') return false;

  return true;
}

function compareNodePresence(
  matched: CrossVersionNodeMatchResult,
  viewport: { width: number; height: number },
): NodePresenceStructuralChange[] {
  const changes: NodePresenceStructuralChange[] = [];

  for (const [key, entry] of matched.baselineUniqueByKey) {
    if (entry.quality !== 'explicit') continue;
    if (matched.candidateObservedKeys.has(key)) continue;

    changes.push({
      kind: 'node-presence',
      direction: 'introduced',
      viewport,
      subject: indexedSubject(entry),
      baselineState: 'visible',
      candidateState: 'missing',
    });
  }

  for (const [key, entry] of matched.candidateUniqueByKey) {
    if (entry.quality !== 'explicit') continue;
    if (matched.baselineObservedKeys.has(key)) continue;

    changes.push({
      kind: 'node-presence',
      direction: 'resolved',
      viewport,
      subject: indexedSubject(entry),
      baselineState: 'missing',
      candidateState: 'visible',
    });
  }

  return changes;
}

function compareReparenting(
  matched: CrossVersionNodeMatchResult,
  viewport: { width: number; height: number },
): ReparentingStructuralChange[] {
  const changes: ReparentingStructuralChange[] = [];

  for (const match of matched.matches) {
    if (match.quality !== 'explicit') continue;

    const baselineParent = matched.baselineUniqueByIndex.get(match.baseline.parentIndex);
    const candidateParent = matched.candidateUniqueByIndex.get(match.candidate.parentIndex);
    if (!baselineParent || !candidateParent) continue;
    if (baselineParent.quality !== 'explicit' || candidateParent.quality !== 'explicit') continue;
    if (baselineParent.key === candidateParent.key) continue;

    const baselineParentInCandidate = matched.candidateUniqueByKey.get(baselineParent.key);
    const candidateParentInBaseline = matched.baselineUniqueByKey.get(candidateParent.key);
    if (!baselineParentInCandidate || !candidateParentInBaseline) continue;
    if (
      baselineParentInCandidate.quality !== 'explicit' ||
      candidateParentInBaseline.quality !== 'explicit'
    ) {
      continue;
    }

    changes.push({
      kind: 'reparenting',
      direction: 'introduced',
      viewport,
      subject: subject(match),
      baselineParent: indexedSubject(baselineParent),
      candidateParent: indexedSubject(candidateParent),
    });
  }

  return changes;
}

function compareParentContainment(
  matches: CrossVersionNodeMatch[],
  baselineMatchedByIndex: Map<number, CrossVersionNodeMatch>,
  candidateMatchedByIndex: Map<number, CrossVersionNodeMatch>,
  viewport: { width: number; height: number },
): ParentContainmentStructuralChange[] {
  const changes: ParentContainmentStructuralChange[] = [];

  for (const match of matches) {
    if (!comparableContainmentNode(match.baseline) || !comparableContainmentNode(match.candidate)) {
      continue;
    }

    const baselineParent = baselineMatchedByIndex.get(match.baseline.parentIndex);
    const candidateParent = candidateMatchedByIndex.get(match.candidate.parentIndex);
    if (!baselineParent || !candidateParent) continue;
    if (baselineParent.key !== candidateParent.key) continue;
    if (
      baselineParent.baseline.tagName === 'HTML' ||
      baselineParent.baseline.tagName === 'BODY' ||
      candidateParent.candidate.tagName === 'HTML' ||
      candidateParent.candidate.tagName === 'BODY'
    ) {
      continue;
    }
    if (
      !comparableContainmentNode(baselineParent.baseline) ||
      !comparableContainmentNode(candidateParent.candidate)
    ) {
      continue;
    }

    const baselineEvidence = containmentRelationshipEvidence(
      baselineParent.baseline.rect,
      match.baseline.rect,
    );
    const candidateEvidence = containmentRelationshipEvidence(
      candidateParent.candidate.rect,
      match.candidate.rect,
    );
    if (baselineEvidence.state === candidateEvidence.state) continue;

    changes.push({
      kind: 'parent-containment',
      direction: direction(baselineEvidence.state, candidateEvidence.state),
      viewport,
      parent: subject(baselineParent),
      subject: subject(match),
      baselineState: baselineEvidence.state,
      candidateState: candidateEvidence.state,
      baselineEvidence,
      candidateEvidence,
    });
  }

  return changes;
}

function groupMatchedChildrenByParent(
  matches: CrossVersionNodeMatch[],
  baselineMatchedByIndex: Map<number, CrossVersionNodeMatch>,
  candidateMatchedByIndex: Map<number, CrossVersionNodeMatch>,
): Map<string, { parent: CrossVersionNodeMatch; children: CrossVersionNodeMatch[] }> {
  const groups = new Map<
    string,
    { parent: CrossVersionNodeMatch; children: CrossVersionNodeMatch[] }
  >();

  for (const match of matches) {
    const baselineParent = baselineMatchedByIndex.get(match.baseline.parentIndex);
    const candidateParent = candidateMatchedByIndex.get(match.candidate.parentIndex);
    if (!baselineParent || !candidateParent) continue;
    if (baselineParent.key !== candidateParent.key) continue;

    const group = groups.get(baselineParent.key) ?? {
      parent: baselineParent,
      children: [],
    };
    group.children.push(match);
    groups.set(baselineParent.key, group);
  }

  return groups;
}

function compareSiblingOverlap(
  matches: CrossVersionNodeMatch[],
  baselineMatchedByIndex: Map<number, CrossVersionNodeMatch>,
  candidateMatchedByIndex: Map<number, CrossVersionNodeMatch>,
  viewport: { width: number; height: number },
): SiblingOverlapStructuralChange[] {
  const changes: SiblingOverlapStructuralChange[] = [];
  const groups = groupMatchedChildrenByParent(
    matches,
    baselineMatchedByIndex,
    candidateMatchedByIndex,
  );

  for (const { parent, children } of groups.values()) {
    for (let firstIndex = 0; firstIndex < children.length; firstIndex += 1) {
      const first = children[firstIndex];
      if (!first) continue;

      for (let secondIndex = firstIndex + 1; secondIndex < children.length; secondIndex += 1) {
        const second = children[secondIndex];
        if (!second) continue;

        const baselineState = overlapRelationshipState(first.baseline.rect, second.baseline.rect);
        const candidateState = overlapRelationshipState(
          first.candidate.rect,
          second.candidate.rect,
        );
        if (baselineState === candidateState) continue;

        changes.push({
          kind: 'sibling-overlap',
          direction: direction(baselineState, candidateState),
          viewport,
          parent: subject(parent),
          subjects: [subject(first), subject(second)],
          baselineState,
          candidateState,
        });
      }
    }
  }

  return changes;
}

function structuralChangeSortKey(change: StructuralChange): string {
  switch (change.kind) {
    case 'parent-containment':
      return `${change.parent.key}|${change.subject.key}`;
    case 'sibling-overlap':
      return `${change.parent.key}|${change.subjects.map((item) => item.key).join('|')}`;
    case 'reparenting':
      return `${change.subject.key}|${change.baselineParent.key}|${change.candidateParent.key}`;
    case 'node-presence':
      return `${change.subject.key}|${change.baselineState}|${change.candidateState}`;
  }
}

export function compareStructuralSurfaces(
  baseline: SurfaceSnapshot<LayoutNode>,
  candidate: SurfaceSnapshot<LayoutNode>,
): StructuralDiff {
  if (baseline.platform !== candidate.platform) {
    throw new Error(
      `Cannot compare structural surfaces from different platforms: ${baseline.platform} vs ${candidate.platform}`,
    );
  }

  if (
    baseline.viewport.width !== candidate.viewport.width ||
    baseline.viewport.height !== candidate.viewport.height
  ) {
    throw new Error(
      `Cannot compare structural surfaces at different viewports: ` +
        `${baseline.viewport.width}x${baseline.viewport.height} vs ` +
        `${candidate.viewport.width}x${candidate.viewport.height}`,
    );
  }

  const matched = matchCrossVersionNodes(baseline.nodes, candidate.nodes);
  const viewport = {
    width: candidate.viewport.width,
    height: candidate.viewport.height,
  };

  const changes: StructuralChange[] = [
    ...compareNodePresence(matched, viewport),
    ...compareReparenting(matched, viewport),
    ...compareParentContainment(
      matched.matches,
      matched.baselineMatchedByIndex,
      matched.candidateMatchedByIndex,
      viewport,
    ),
    ...compareSiblingOverlap(
      matched.matches,
      matched.baselineMatchedByIndex,
      matched.candidateMatchedByIndex,
      viewport,
    ),
  ];

  changes.sort((first, second) => {
    const kind = first.kind.localeCompare(second.kind);
    if (kind !== 0) return kind;
    return structuralChangeSortKey(first).localeCompare(structuralChangeSortKey(second));
  });

  return {
    platform: candidate.platform,
    viewport,
    matchedNodes: matched.matches.length,
    changes,
  };
}
