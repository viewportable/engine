import type { LayoutNode } from '../types.js';

const GENERATED_ID = /^[a-z]*[-_]?[0-9a-f]{6,}$/i;
const CSS_MODULE_HASH = /_[a-z0-9]{5,}$/i;
const EXPLICIT_ATTRIBUTES = ['data-testid', 'data-test', 'data-qa'] as const;

export type CrossVersionMatchQuality = 'explicit' | 'structural';

export interface CrossVersionNodeKey {
  key: string;
  quality: CrossVersionMatchQuality;
}

export interface CrossVersionNodeMatch {
  key: string;
  quality: CrossVersionMatchQuality;
  baseline: LayoutNode;
  candidate: LayoutNode;
}

export interface CrossVersionNodeMatchResult {
  matches: CrossVersionNodeMatch[];
  baselineMatchedByIndex: Map<number, CrossVersionNodeMatch>;
  candidateMatchedByIndex: Map<number, CrossVersionNodeMatch>;
}

function stableId(node: LayoutNode): string | null {
  const id = node.attributes.id?.trim();
  if (!id) return null;
  if (id.includes(':r')) return null;
  if (GENERATED_ID.test(id)) return null;
  return id;
}

function stableClasses(node: LayoutNode): string[] {
  return (node.attributes.class ?? '')
    .split(/\s+/)
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((value) => !CSS_MODULE_HASH.test(value))
    .slice(0, 3);
}

function explicitNodeKey(node: LayoutNode): string | null {
  const id = stableId(node);
  if (id) return `id:${id}`;

  for (const attribute of EXPLICIT_ATTRIBUTES) {
    const value = node.attributes[attribute]?.trim();
    if (value) return `${attribute}:${value}`;
  }

  return null;
}

function structuralSegment(node: LayoutNode): string {
  const tag = node.tagName.toLowerCase();
  const classes = stableClasses(node);
  const classPart = classes.length > 0 ? `.${classes.join('.')}` : '';
  const nthPart = node.nthChild ? `:nth-child(${node.nthChild})` : '';

  return `${tag}${classPart}${nthPart}`;
}

export function crossVersionNodeKey(
  node: LayoutNode,
  nodesByIndex: Map<number, LayoutNode>,
): CrossVersionNodeKey | null {
  const explicit = explicitNodeKey(node);
  if (explicit) return { key: explicit, quality: 'explicit' };

  const segments: string[] = [];
  let current: LayoutNode | undefined = node;
  const seen = new Set<number>();

  while (current && !seen.has(current.index) && segments.length < 5) {
    seen.add(current.index);

    const currentExplicit = explicitNodeKey(current);
    if (currentExplicit) {
      return {
        key: `${currentExplicit}>${segments.reverse().join('>')}`,
        quality: 'structural',
      };
    }

    segments.push(structuralSegment(current));
    current = nodesByIndex.get(current.parentIndex);
  }

  if (segments.length === 0) return null;

  return {
    key: `path:${segments.reverse().join('>')}`,
    quality: 'structural',
  };
}

function uniqueKeyIndex(nodes: LayoutNode[]): Map<string, { node: LayoutNode; quality: CrossVersionMatchQuality }> {
  const nodesByIndex = new Map(nodes.map((node) => [node.index, node]));
  const grouped = new Map<string, Array<{ node: LayoutNode; quality: CrossVersionMatchQuality }>>();

  for (const node of nodes) {
    if (!node.isVisible) continue;

    const identity = crossVersionNodeKey(node, nodesByIndex);
    if (!identity) continue;

    const entries = grouped.get(identity.key) ?? [];
    entries.push({ node, quality: identity.quality });
    grouped.set(identity.key, entries);
  }

  const unique = new Map<string, { node: LayoutNode; quality: CrossVersionMatchQuality }>();
  for (const [key, entries] of grouped) {
    if (entries.length === 1 && entries[0]) {
      unique.set(key, entries[0]);
    }
  }

  return unique;
}

export function matchCrossVersionNodes(
  baseline: LayoutNode[],
  candidate: LayoutNode[],
): CrossVersionNodeMatchResult {
  const baselineByKey = uniqueKeyIndex(baseline);
  const candidateByKey = uniqueKeyIndex(candidate);
  const matches: CrossVersionNodeMatch[] = [];

  for (const [key, baselineEntry] of baselineByKey) {
    const candidateEntry = candidateByKey.get(key);
    if (!candidateEntry) continue;

    matches.push({
      key,
      quality:
        baselineEntry.quality === 'explicit' && candidateEntry.quality === 'explicit'
          ? 'explicit'
          : 'structural',
      baseline: baselineEntry.node,
      candidate: candidateEntry.node,
    });
  }

  matches.sort((first, second) => first.key.localeCompare(second.key));

  return {
    matches,
    baselineMatchedByIndex: new Map(matches.map((match) => [match.baseline.index, match])),
    candidateMatchedByIndex: new Map(matches.map((match) => [match.candidate.index, match])),
  };
}
