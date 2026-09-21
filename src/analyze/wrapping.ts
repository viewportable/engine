import { inferSiblingRows } from '../relationships/rows.js';
import type { LayoutNode } from '../types.js';

export interface WrappingSample {
  width: number;
  nodes: LayoutNode[];
}

export interface DetectedWrappingTransition {
  nodeIndex: number;
  parentIndex: number;
  viewportWidth: number;
  previousViewportWidth: number;
  previousRowSize: number;
  currentRowSize: number;
  stableSiblingCount: number;
  previousRowIndex: number;
  currentRowIndex: number;
  verticalShiftPx: number;
  bbox: [number, number, number, number];
  tagName: string;
}

function identityOf(node: LayoutNode): string {
  return node.identity ?? `snapshot:${node.index}`;
}

function rowGroups(
  identities: string[],
  rowByIdentity: Map<string, number>,
): Map<number, string[]> {
  const groups = new Map<number, string[]>();

  for (const identity of identities) {
    const rowIndex = rowByIdentity.get(identity);
    if (rowIndex === undefined) continue;
    const members = groups.get(rowIndex) ?? [];
    members.push(identity);
    groups.set(rowIndex, members);
  }

  return groups;
}

export function detectWrappingTransitions(samples: WrappingSample[]): DetectedWrappingTransition[] {
  const ordered = [...samples].sort((first, second) => second.width - first.width);
  const findings: DetectedWrappingTransition[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < ordered.length - 1; index += 1) {
    const wider = ordered[index];
    const narrower = ordered[index + 1];
    if (!wider || !narrower || wider.width === narrower.width) continue;

    const widerRows = inferSiblingRows(wider.nodes);
    const narrowerRows = inferSiblingRows(narrower.nodes);
    const widerByIdentity = new Map(wider.nodes.map((node) => [identityOf(node), node]));
    const narrowerByIdentity = new Map(narrower.nodes.map((node) => [identityOf(node), node]));

    for (const [parentIdentity, widerParent] of widerRows) {
      const narrowerParent = narrowerRows.get(parentIdentity);
      const currentParent = narrowerByIdentity.get(parentIdentity);
      if (!narrowerParent || !currentParent) continue;

      for (let widerRowIndex = 0; widerRowIndex < widerParent.rows.length; widerRowIndex += 1) {
        const widerRow = widerParent.rows[widerRowIndex];
        if (!widerRow || widerRow.nodeIdentities.length < 3) continue;

        const commonIdentities = widerRow.nodeIdentities.filter(
          (identity) =>
            narrowerByIdentity.has(identity) && narrowerParent.rowByIdentity.has(identity),
        );
        if (commonIdentities.length < 3) continue;

        const groups = rowGroups(commonIdentities, narrowerParent.rowByIdentity);
        if (groups.size < 2) continue;

        const rankedGroups = [...groups.entries()].sort(
          (first, second) => second[1].length - first[1].length || first[0] - second[0],
        );
        const stableGroup = rankedGroups[0];
        if (!stableGroup || stableGroup[1].length < 2) continue;

        for (const [currentRowIndex, movedIdentities] of rankedGroups.slice(1)) {
          if (movedIdentities.length >= stableGroup[1].length) continue;
          if (currentRowIndex <= stableGroup[0]) continue;

          for (const identity of movedIdentities) {
            const previousNode = widerByIdentity.get(identity);
            const currentNode = narrowerByIdentity.get(identity);
            if (!previousNode || !currentNode) continue;

            const verticalShiftPx = Math.round(currentNode.rect.y - previousNode.rect.y);
            if (verticalShiftPx <= 4) continue;

            const key = `${narrower.width}|${parentIdentity}|${identity}`;
            if (seen.has(key)) continue;
            seen.add(key);

            findings.push({
              nodeIndex: currentNode.index,
              parentIndex: currentParent.index,
              viewportWidth: narrower.width,
              previousViewportWidth: wider.width,
              previousRowSize: commonIdentities.length,
              currentRowSize: movedIdentities.length,
              stableSiblingCount: stableGroup[1].length,
              previousRowIndex: widerRowIndex,
              currentRowIndex,
              verticalShiftPx,
              bbox: [
                currentNode.rect.x,
                currentNode.rect.y,
                currentNode.rect.width,
                currentNode.rect.height,
              ],
              tagName: currentNode.tagName,
            });
          }
        }
      }
    }
  }

  return findings;
}
