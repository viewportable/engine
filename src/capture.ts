import type { CDPSession } from 'playwright';
import type { SurfaceSnapshot, SurfaceTextBox } from './surface.js';
import type { LayoutNode, Viewport } from './types.js';

const COMPUTED_STYLES = [
  'position',
  'overflow',
  'overflow-x',
  'overflow-y',
  'display',
  'visibility',
  'opacity',
  'pointer-events',
  'z-index',
  'transform',
  'clip-path',
  'min-width',
  'width',
  'max-width',
  'grid-template-columns',
  'flex-wrap',
] as const;

interface NodeTreeSnapshot {
  parentIndex?: number[];
  backendNodeId?: number[];
  nodeType?: number[];
  nodeName?: number[];
  attributes?: number[][];
}

function decodeAttributes(
  encoded: number[] | undefined,
  strings: string[],
): Record<string, string> {
  const attributes: Record<string, string> = {};
  if (!encoded) return attributes;

  for (let i = 0; i < encoded.length; i += 2) {
    const name = strings[encoded[i] ?? -1];
    const value = strings[encoded[i + 1] ?? -1];
    if (name !== undefined && value !== undefined) {
      attributes[name] = value;
    }
  }

  return attributes;
}

function computeNthChildren(nodes: NodeTreeSnapshot): Map<number, number> {
  const positions = new Map<number, number>();
  const countsByParent = new Map<number, number>();

  for (let index = 0; index < (nodes.nodeType?.length ?? 0); index += 1) {
    if (nodes.nodeType?.[index] !== 1) continue;

    const parentIndex = nodes.parentIndex?.[index] ?? -1;
    const position = (countsByParent.get(parentIndex) ?? 0) + 1;
    countsByParent.set(parentIndex, position);
    positions.set(index, position);
  }

  return positions;
}

function nearestCapturedParentIndex(
  parentIndex: number,
  capturedIndices: Set<number>,
  rawParentIndices: number[] | undefined,
): number {
  let currentIndex = parentIndex;
  const seen = new Set<number>();

  while (currentIndex !== -1 && !seen.has(currentIndex)) {
    if (capturedIndices.has(currentIndex)) return currentIndex;

    seen.add(currentIndex);
    currentIndex = rawParentIndices?.[currentIndex] ?? -1;
  }

  return -1;
}

interface CaptureLayoutOptions {
  includeTextRanges?: boolean;
}

interface CapturedLayout {
  nodes: LayoutNode[];
  textBoxes: SurfaceTextBox[];
}

export async function captureLayout(
  cdp: CDPSession,
  options: CaptureLayoutOptions = {},
): Promise<CapturedLayout> {
  const snapshot = await cdp.send('DOMSnapshot.captureSnapshot', {
    computedStyles: [...COMPUTED_STYLES],
    includeDOMRects: true,
    includePaintOrder: true,
  });

  const document = snapshot.documents[0];
  if (!document) return { nodes: [], textBoxes: [] };

  const { nodes, layout } = document;
  const nthChildren = computeNthChildren(nodes);
  const result: LayoutNode[] = [];

  for (let layoutIndex = 0; layoutIndex < layout.nodeIndex.length; layoutIndex += 1) {
    const nodeIndex = layout.nodeIndex[layoutIndex];
    if (nodeIndex === undefined) continue;
    if (nodes.nodeType?.[nodeIndex] !== 1) continue;

    const bounds = layout.bounds[layoutIndex];
    if (!bounds) continue;

    const [x, y, width, height] = bounds;
    if (width === 0 || height === 0) continue;

    const styleValues = layout.styles[layoutIndex] ?? [];
    const styles = Object.fromEntries(
      COMPUTED_STYLES.map((name, styleIndex) => [
        name,
        snapshot.strings[styleValues[styleIndex] ?? -1] ?? '',
      ]),
    );

    const visibility = styles.visibility.toLowerCase();
    const display = styles.display.toLowerCase();
    const isVisible = display !== 'none' && visibility !== 'hidden' && visibility !== 'collapse';

    if (!isVisible) continue;

    const backendNodeId = nodes.backendNodeId?.[nodeIndex];

    result.push({
      index: nodeIndex,
      parentIndex: nodes.parentIndex?.[nodeIndex] ?? -1,
      ...(backendNodeId !== undefined ? { identity: `web:${backendNodeId}` } : {}),
      tagName: (snapshot.strings[nodes.nodeName?.[nodeIndex] ?? -1] ?? '').toUpperCase(),
      attributes: decodeAttributes(nodes.attributes?.[nodeIndex], snapshot.strings),
      rect: { x, y, width, height },
      styles,
      paintOrder: layout.paintOrders?.[layoutIndex] ?? 0,
      isVisible,
      nthChild: nthChildren.get(nodeIndex),
    });
  }

  const capturedIndices = new Set(result.map((node) => node.index));

  const normalizedNodes = result.map((node) => ({
    ...node,
    parentIndex: nearestCapturedParentIndex(node.parentIndex, capturedIndices, nodes.parentIndex),
  }));
  const normalizedByIndex = new Map(normalizedNodes.map((node) => [node.index, node]));
  const textBoxes: SurfaceTextBox[] = [];

  if (options.includeTextRanges) {
    const textBoxSnapshot = document.textBoxes;

    for (let textBoxIndex = 0; textBoxIndex < textBoxSnapshot.layoutIndex.length; textBoxIndex += 1) {
      const layoutIndex = textBoxSnapshot.layoutIndex[textBoxIndex];
      if (layoutIndex === undefined) continue;

      const rawNodeIndex = layout.nodeIndex[layoutIndex];
      if (rawNodeIndex === undefined) continue;

      const ownerIndex = capturedIndices.has(rawNodeIndex)
        ? rawNodeIndex
        : nearestCapturedParentIndex(
            nodes.parentIndex?.[rawNodeIndex] ?? -1,
            capturedIndices,
            nodes.parentIndex,
          );
      const owner = normalizedByIndex.get(ownerIndex);
      const bounds = textBoxSnapshot.bounds[textBoxIndex];

      if (!owner?.identity || !bounds) continue;

      const [x, y, width, height] = bounds;
      if (width <= 0 || height <= 0) continue;

      textBoxes.push({
        ownerIdentity: owner.identity,
        rect: { x, y, width, height },
        start: textBoxSnapshot.start[textBoxIndex] ?? 0,
        length: textBoxSnapshot.length[textBoxIndex] ?? 0,
      });
    }
  }

  return {
    nodes: normalizedNodes,
    textBoxes,
  };
}

export async function captureBrowserSurface(
  cdp: CDPSession,
  viewport: Viewport,
  options: CaptureLayoutOptions = {},
): Promise<SurfaceSnapshot<LayoutNode>> {
  const captured = await captureLayout(cdp, options);
  const capabilities = ['geometry', 'computed-styles', 'paint-order', 'tree'] as const;

  return {
    platform: 'web',
    viewport,
    capabilities: options.includeTextRanges ? [...capabilities, 'text-ranges'] : capabilities,
    nodes: captured.nodes,
    ...(options.includeTextRanges
      ? {
          evidence: {
            textBoxes: captured.textBoxes,
          },
        }
      : {}),
  };
}
