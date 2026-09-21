import type { BrowserRuntime } from '../browser.js';
import { launchBrowser } from '../browser.js';
import { captureBrowserSurface } from '../capture.js';
import { installStabilization, stabilizeViewport } from '../stabilize.js';
import type { SurfaceSnapshot } from '../surface.js';
import type { LayoutNode } from '../types.js';
import { aggregateStructuralChangeRanges, type StructuralChangeRange } from './ranges.js';
import { compareStructuralSurfaces, type StructuralDiff } from './structural-diff.js';

export interface StructuralCompareRunOptions {
  widths: number[];
  height: number;
  waitMs: number;
  timeoutMs: number;
  readySelector?: string;
}

export interface StructuralCompareReport {
  version: 1;
  baselineUrl: string;
  candidateUrl: string;
  timestamp: string;
  userAgent: string;
  summary: {
    viewportsChecked: number;
    matchedNodes: number;
    introducedChanges: number;
    resolvedChanges: number;
    totalChanges: number;
    introducedRanges: number;
    resolvedRanges: number;
    totalRanges: number;
    durationMs: number;
  };
  viewports: StructuralDiff[];
  ranges: StructuralChangeRange[];
}

async function navigateAndCapture(
  runtime: BrowserRuntime,
  url: string,
  options: StructuralCompareRunOptions,
): Promise<Map<number, SurfaceSnapshot<LayoutNode>>> {
  await runtime.page.goto(url, { timeout: options.timeoutMs });

  if (options.readySelector) {
    await runtime.page.waitForSelector(options.readySelector, {
      state: 'visible',
      timeout: options.timeoutMs,
    });
  }

  const captures = new Map<number, SurfaceSnapshot<LayoutNode>>();

  for (const width of options.widths) {
    await stabilizeViewport(runtime.page, width, options.height, options.waitMs);
    captures.set(
      width,
      await captureBrowserSurface(runtime.cdp, {
        width,
        height: options.height,
      }),
    );
  }

  return captures;
}

export async function runStructuralCompare(
  baselineUrl: string,
  candidateUrl: string,
  options: StructuralCompareRunOptions,
): Promise<StructuralCompareReport> {
  const startedAt = Date.now();
  const runtime = await launchBrowser({
    width: options.widths[0] ?? 320,
    height: options.height,
  });

  try {
    await installStabilization(runtime.context);

    const baselineCaptures = await navigateAndCapture(runtime, baselineUrl, options);
    const candidateCaptures = await navigateAndCapture(runtime, candidateUrl, options);
    const viewports: StructuralDiff[] = [];

    for (const width of options.widths) {
      const baseline = baselineCaptures.get(width);
      const candidate = candidateCaptures.get(width);
      if (!baseline || !candidate) {
        throw new Error(`Missing structural capture for viewport ${width}px`);
      }

      viewports.push(compareStructuralSurfaces(baseline, candidate));
    }

    const introducedChanges = viewports.reduce(
      (sum, viewport) =>
        sum + viewport.changes.filter((change) => change.direction === 'introduced').length,
      0,
    );
    const resolvedChanges = viewports.reduce(
      (sum, viewport) =>
        sum + viewport.changes.filter((change) => change.direction === 'resolved').length,
      0,
    );

    const ranges = aggregateStructuralChangeRanges(viewports);
    const introducedRanges = ranges.filter((range) => range.direction === 'introduced').length;
    const resolvedRanges = ranges.filter((range) => range.direction === 'resolved').length;

    return {
      version: 1,
      baselineUrl,
      candidateUrl,
      timestamp: new Date().toISOString(),
      userAgent: `Chromium/${runtime.browser.version()}`,
      summary: {
        viewportsChecked: viewports.length,
        matchedNodes: viewports.reduce((sum, viewport) => sum + viewport.matchedNodes, 0),
        introducedChanges,
        resolvedChanges,
        totalChanges: introducedChanges + resolvedChanges,
        introducedRanges,
        resolvedRanges,
        totalRanges: ranges.length,
        durationMs: Date.now() - startedAt,
      },
      viewports,
      ranges,
    };
  } finally {
    await runtime.browser.close();
  }
}
