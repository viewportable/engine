import type { BrowserRuntime } from '../browser.js';
import { launchBrowser } from '../browser.js';
import { captureBrowserSurface } from '../capture.js';
import { installStabilization, stabilizeViewport } from '../stabilize.js';
import type { SurfaceSnapshot } from '../surface.js';
import type { LayoutNode } from '../types.js';
import { refineIntroducedStructuralRangeBoundaries } from './boundaries.js';
import { buildStructuralFindings, type StructuralFinding } from './findings.js';
import { attributeStructuralFindingSources } from './source-attribution.js';
import {
  aggregateStructuralChangeRanges,
  structuralChangeFingerprint,
  type StructuralChangeRange,
} from './ranges.js';
import { compareStructuralSurfaces, type StructuralDiff } from './structural-diff.js';

export interface StructuralCompareRunOptions {
  widths: number[];
  height: number;
  waitMs: number;
  timeoutMs: number;
  boundary: boolean;
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
    exactBoundaries: number;
    boundaryProbes: number;
    durationMs: number;
  };
  viewports: StructuralDiff[];
  ranges: StructuralChangeRange[];
  findings: StructuralFinding[];
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

async function captureStructuralDiffAtWidth(
  baselineRuntime: BrowserRuntime,
  candidateRuntime: BrowserRuntime,
  width: number,
  options: StructuralCompareRunOptions,
): Promise<StructuralDiff> {
  await Promise.all([
    stabilizeViewport(baselineRuntime.page, width, options.height, options.waitMs),
    stabilizeViewport(candidateRuntime.page, width, options.height, options.waitMs),
  ]);

  const [baseline, candidate] = await Promise.all([
    captureBrowserSurface(baselineRuntime.cdp, {
      width,
      height: options.height,
    }),
    captureBrowserSurface(candidateRuntime.cdp, {
      width,
      height: options.height,
    }),
  ]);

  return compareStructuralSurfaces(baseline, candidate);
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

    const candidatePage = await runtime.context.newPage();
    const candidateCdp = await runtime.context.newCDPSession(candidatePage);
    const candidateRuntime: BrowserRuntime = {
      browser: runtime.browser,
      context: runtime.context,
      page: candidatePage,
      cdp: candidateCdp,
    };

    const [baselineCaptures, candidateCaptures] = await Promise.all([
      navigateAndCapture(runtime, baselineUrl, options),
      navigateAndCapture(candidateRuntime, candidateUrl, options),
    ]);
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

    let ranges = aggregateStructuralChangeRanges(viewports);
    let boundaryProbes = 0;

    if (options.boundary) {
      const diffByWidth = new Map<number, Promise<StructuralDiff>>(
        viewports.map((viewport) => [viewport.viewport.width, Promise.resolve(viewport)]),
      );
      let probeQueue: Promise<void> = Promise.resolve();

      const diffAtWidth = (width: number): Promise<StructuralDiff> => {
        const existing = diffByWidth.get(width);
        if (existing) return existing;

        boundaryProbes += 1;
        const scheduled = probeQueue.then(() =>
          captureStructuralDiffAtWidth(runtime, candidateRuntime, width, options),
        );
        probeQueue = scheduled.then(
          () => undefined,
          () => undefined,
        );
        diffByWidth.set(width, scheduled);
        return scheduled;
      };

      ranges = await refineIntroducedStructuralRangeBoundaries(
        ranges,
        viewports,
        async (width, fingerprint) => {
          const diff = await diffAtWidth(width);
          return diff.changes.some((change) => structuralChangeFingerprint(change) === fingerprint);
        },
      );
    }

    const introducedRanges = ranges.filter((range) => range.direction === 'introduced').length;
    const resolvedRanges = ranges.filter((range) => range.direction === 'resolved').length;
    const exactBoundaries = ranges.reduce((sum, range) => sum + range.boundaries.length, 0);
    const findings = buildStructuralFindings(ranges);

    await attributeStructuralFindingSources({
      page: candidateRuntime.page,
      candidateCaptures,
      findings,
      height: options.height,
      waitMs: options.waitMs,
    });

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
        exactBoundaries,
        boundaryProbes,
        durationMs: Date.now() - startedAt,
      },
      viewports,
      ranges,
      findings,
    };
  } finally {
    await runtime.browser.close();
  }
}
