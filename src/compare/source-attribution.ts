import type { CDPSession, Page } from 'playwright';
import { findUniqueCssSource } from '../css-source.js';
import { findCssSourceLocation } from '../css-source-location.js';
import { findAuthoredCssSourceLocation } from '../css-source-map.js';
import { buildStableSelector, makePageUniquenessCheck } from '../selector.js';
import { stabilizeViewport } from '../stabilize.js';
import type { SurfaceSnapshot } from '../surface.js';
import type { CssSourceReference, LayoutNode } from '../types.js';
import { uniqueNodeByCrossVersionKey } from './node-match.js';
import type { StructuralFinding } from './findings.js';

function parsePixelValue(value: string | undefined): number | null {
  if (!value) return null;
  const match = value.trim().match(/^(-?\d+(?:\.\d+)?)px$/i);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function protrusionConstraint(
  node: LayoutNode,
  parent: LayoutNode,
): { property: 'min-width' | 'width'; value: string } | null {
  const availableWidth = parent.rect.width;
  const minWidthValue = node.styles['min-width']?.trim() ?? '';
  const minWidth = parsePixelValue(minWidthValue);

  if (minWidth !== null && minWidth > availableWidth + 1 && node.rect.width + 1 >= minWidth) {
    return { property: 'min-width', value: minWidthValue };
  }

  const widthValue = node.styles.width?.trim() ?? '';
  const width = parsePixelValue(widthValue);

  if (width !== null && width > availableWidth + 1 && node.rect.width + 1 >= width) {
    return { property: 'width', value: widthValue };
  }

  return null;
}

export async function attributeStructuralFindingSources({
  page,
  cdp,
  candidateCaptures,
  findings,
  height,
  waitMs,
}: {
  page: Page;
  cdp: CDPSession;
  candidateCaptures: Map<number, SurfaceSnapshot<LayoutNode>>;
  findings: StructuralFinding[];
  height: number;
  waitMs: number;
}): Promise<void> {
  const isUnique = makePageUniquenessCheck((selector) =>
    page.evaluate((value) => document.querySelectorAll(value).length, selector),
  );

  for (const finding of findings) {
    finding.source = null;
    if (finding.direction !== 'introduced' || finding.type !== 'protrusion') continue;

    const width = finding.sampledRange.widths[0];
    const parentKey = finding.candidate.parent?.key;
    if (width === undefined || !parentKey) continue;

    const capture = candidateCaptures.get(width);
    if (!capture) continue;

    const node = uniqueNodeByCrossVersionKey(capture.nodes, finding.subject.key);
    const parent = uniqueNodeByCrossVersionKey(capture.nodes, parentKey);
    if (!node || !parent) continue;

    const constraint = protrusionConstraint(node, parent);
    if (!constraint) continue;

    await stabilizeViewport(page, width, height, waitMs);
    const selector = await buildStableSelector(node, capture.nodes, isUnique);
    const source = await findUniqueCssSource(page, selector, constraint.property, constraint.value);

    if (source) {
      const location = await findCssSourceLocation(cdp, selector, source);
      const authoredLocation =
        location === null
          ? null
          : await findAuthoredCssSourceLocation({
              source,
              location,
              fetchText: async (url) => {
                try {
                  const response = await page.request.get(url);
                  return response.ok() ? response.text() : null;
                } catch {
                  return null;
                }
              },
            });

      finding.source = {
        ...source,
        location,
        authoredLocation,
      };
    }
  }
}

export function sourceAttributionForFinding(finding: StructuralFinding): CssSourceReference | null {
  return finding.source ?? null;
}
