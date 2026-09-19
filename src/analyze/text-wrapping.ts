import type { SurfaceTextBox } from '../surface.js';
import type { LayoutNode } from '../types.js';

export interface TextWrappingSample {
  width: number;
  nodes: LayoutNode[];
  textBoxes: SurfaceTextBox[];
}

export interface DetectedTextWrappingTransition {
  nodeIndex: number;
  parentIndex: number;
  viewportWidth: number;
  previousViewportWidth: number;
  previousLineCount: number;
  currentLineCount: number;
  stableSiblingCount: number;
  changedSiblingCount: number;
  bbox: [number, number, number, number];
  tagName: string;
}

interface TextMetric {
  node: LayoutNode;
  lineCount: number;
}

const LINE_Y_TOLERANCE_PX = 2;

function participatesInFlow(node: LayoutNode): boolean {
  const position = node.styles.position?.toLowerCase();
  const transform = node.styles.transform?.trim().toLowerCase();

  if (position === 'absolute' || position === 'fixed') return false;
  if (transform && transform !== 'none') return false;

  return node.isVisible && node.rect.width > 0 && node.rect.height > 0;
}

function countLines(boxes: SurfaceTextBox[]): number {
  const rows: number[] = [];

  for (const box of [...boxes].sort((first, second) => first.rect.y - second.rect.y)) {
    const center = box.rect.y + box.rect.height / 2;
    const existing = rows.findIndex((value) => Math.abs(value - center) <= LINE_Y_TOLERANCE_PX);

    if (existing === -1) {
      rows.push(center);
    }
  }

  return rows.length;
}

function childrenByParent(nodes: LayoutNode[]): Map<number, LayoutNode[]> {
  const result = new Map<number, LayoutNode[]>();

  for (const node of nodes) {
    if (node.parentIndex === -1 || !participatesInFlow(node)) continue;
    const children = result.get(node.parentIndex) ?? [];
    children.push(node);
    result.set(node.parentIndex, children);
  }

  return result;
}

function findComparisonAnchor(
  owner: LayoutNode,
  nodesByIndex: Map<number, LayoutNode>,
  childMap: Map<number, LayoutNode[]>,
): LayoutNode | undefined {
  let current: LayoutNode | undefined = owner;
  const seen = new Set<number>();

  while (current && !seen.has(current.index)) {
    seen.add(current.index);
    const parent = nodesByIndex.get(current.parentIndex);
    if (!parent) return undefined;

    const siblings = childMap.get(parent.index) ?? [];
    if (siblings.length >= 3) return current;

    current = parent;
  }

  return undefined;
}

function buildMetrics(sample: TextWrappingSample): Map<string, TextMetric> {
  const nodesByIndex = new Map(sample.nodes.map((node) => [node.index, node]));
  const nodesByIdentity = new Map(
    sample.nodes
      .filter((node): node is LayoutNode & { identity: string } => Boolean(node.identity))
      .map((node) => [node.identity, node]),
  );
  const childMap = childrenByParent(sample.nodes);
  const boxesByAnchor = new Map<string, SurfaceTextBox[]>();
  const anchorByIdentity = new Map<string, LayoutNode>();

  for (const box of sample.textBoxes) {
    const owner = nodesByIdentity.get(box.ownerIdentity);
    if (!owner) continue;

    const anchor = findComparisonAnchor(owner, nodesByIndex, childMap);
    if (!anchor?.identity) continue;

    const boxes = boxesByAnchor.get(anchor.identity) ?? [];
    boxes.push(box);
    boxesByAnchor.set(anchor.identity, boxes);
    anchorByIdentity.set(anchor.identity, anchor);
  }

  const metrics = new Map<string, TextMetric>();

  for (const [identity, boxes] of boxesByAnchor) {
    const node = anchorByIdentity.get(identity);
    if (!node) continue;

    const lineCount = countLines(boxes);
    if (lineCount === 0) continue;

    metrics.set(identity, { node, lineCount });
  }

  return metrics;
}

export function detectTextWrappingTransitions(
  samples: TextWrappingSample[],
): DetectedTextWrappingTransition[] {
  const ordered = [...samples].sort((first, second) => second.width - first.width);
  const findings: DetectedTextWrappingTransition[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < ordered.length - 1; index += 1) {
    const wider = ordered[index];
    const narrower = ordered[index + 1];
    if (!wider || !narrower || wider.width === narrower.width) continue;

    const widerMetrics = buildMetrics(wider);
    const narrowerMetrics = buildMetrics(narrower);
    const narrowerNodesByIndex = new Map(narrower.nodes.map((node) => [node.index, node]));
    const currentChildren = childrenByParent(narrower.nodes);

    for (const [identity, previous] of widerMetrics) {
      const current = narrowerMetrics.get(identity);
      if (!current) continue;
      if (previous.lineCount !== 1 || current.lineCount <= previous.lineCount) continue;

      const currentParent = narrowerNodesByIndex.get(current.node.parentIndex);
      if (!currentParent?.identity) continue;

      const siblingNodes = (currentChildren.get(currentParent.index) ?? []).filter(
        (node): node is LayoutNode & { identity: string } => Boolean(node.identity),
      );
      if (siblingNodes.length < 3) continue;

      let stableSiblingCount = 0;
      let changedSiblingCount = 0;

      for (const sibling of siblingNodes) {
        const before = widerMetrics.get(sibling.identity);
        const after = narrowerMetrics.get(sibling.identity);
        if (!before || !after) continue;

        if (before.lineCount === after.lineCount) {
          if (sibling.identity !== identity) stableSiblingCount += 1;
        } else {
          changedSiblingCount += 1;
        }
      }

      if (stableSiblingCount < 2) continue;
      if (changedSiblingCount >= stableSiblingCount) continue;

      const key = `${narrower.width}|${identity}`;
      if (seen.has(key)) continue;
      seen.add(key);

      findings.push({
        nodeIndex: current.node.index,
        parentIndex: current.node.parentIndex,
        viewportWidth: narrower.width,
        previousViewportWidth: wider.width,
        previousLineCount: previous.lineCount,
        currentLineCount: current.lineCount,
        stableSiblingCount,
        changedSiblingCount,
        bbox: [
          current.node.rect.x,
          current.node.rect.y,
          current.node.rect.width,
          current.node.rect.height,
        ],
        tagName: current.node.tagName,
      });
    }
  }

  return findings;
}
