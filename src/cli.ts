#!/usr/bin/env node
import { Command, CommanderError } from 'commander';
import type { Page } from 'playwright';
import pc from 'picocolors';
import {
  documentOverflowsHorizontally,
  getDocumentMetrics,
  launchBrowser,
  type DocumentMetrics,
} from './browser.js';
import { findBoundary } from './boundary.js';
import { captureBrowserSurface } from './capture.js';
import { loadSliceConfig, type SliceConfig, type SuppressionRule } from './config.js';
import { findUniqueCssSource } from './css-source.js';
import { fixedElementCollisionDetector } from './detect/fixed-collision.js';
import { fixedContentOcclusionDetector } from './detect/fixed-occlusion.js';
import { horizontalOverflowDetector } from './detect/overflow.js';
import { runDetector } from './detector.js';
import { diagnoseHorizontalOverflowRoot } from './diagnose.js';
import { groupHorizontalOverflow } from './grouping.js';
import { writeResults } from './report.js';
import { buildStableSelector, makePageUniquenessCheck } from './selector.js';
import { installStabilization, stabilizeViewport } from './stabilize.js';
import { partitionSuppressedIssues } from './suppress.js';
import type { SurfaceSnapshot } from './surface.js';
import type {
  BoundaryResult,
  HorizontalOverflowIssue,
  Issue,
  LayoutNode,
  RootCause,
  RootCauseBoundary,
  RootCauseDiagnosis,
  RootCauseObservation,
  SliceResults,
  ViewportResult,
} from './types.js';

const DEFAULT_WIDTHS = [320, 375, 390, 430, 768, 1024, 1280, 1440];
const DEFAULT_HEIGHT = 900;
const DEFAULT_WAIT_MS = 300;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_OUT_DIR = '.slice';

interface CliOptions {
  widths: string;
  height: string;
  out: string;
  json: boolean;
  boundary: boolean;
  timeout: string;
  wait: string;
  readySelector?: string;
  config?: string;
}

interface RunOptions extends CliOptions {
  suppressions: SuppressionRule[];
}

interface BoundaryDisplay {
  result: BoundaryResult;
  rangeStart: number;
  rangeEnd: number;
}

interface RootCauseBoundaryResult extends RootCauseBoundary {
  rootCauseId: string;
}

interface CapturedRootCause extends RootCauseObservation {
  id: string;
  selector: string;
  tagName: string;
  side: 'right' | 'left';
  diagnosis?: RootCauseDiagnosis;
}

interface CaptureResult {
  issues: Issue[];
  suppressedIssues: Issue[];
  rootCauses: CapturedRootCause[];
}

type RawCaptureResult = Omit<CaptureResult, 'suppressedIssues'>;

class SliceCliError extends Error {}

function parsePositiveInteger(value: string, name: string, allowZero = false): number {
  const parsed = Number(value);
  const valid = Number.isInteger(parsed) && (allowZero ? parsed >= 0 : parsed > 0);

  if (!valid) {
    throw new SliceCliError(
      `${name} must be ${allowZero ? 'a non-negative' : 'a positive'} integer`,
    );
  }

  return parsed;
}

function parseWidths(value: string): number[] {
  const widths = value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => parsePositiveInteger(part, '--widths'));

  if (widths.length === 0) {
    throw new SliceCliError('--widths must contain at least one width');
  }

  return [...new Set(widths)];
}

function optionFromConfig<T>(
  command: Command,
  name: string,
  cliValue: T,
  configValue: T | undefined,
): T {
  return command.getOptionValueSource(name) === 'cli' ? cliValue : (configValue ?? cliValue);
}

function resolveRunOptions(command: Command, options: CliOptions, config: SliceConfig): RunOptions {
  return {
    ...options,
    widths: optionFromConfig(command, 'widths', options.widths, config.widths?.join(',')),
    height: optionFromConfig(
      command,
      'height',
      options.height,
      config.height === undefined ? undefined : String(config.height),
    ),
    out: optionFromConfig(command, 'out', options.out, config.out),
    boundary: optionFromConfig(command, 'boundary', options.boundary, config.boundary),
    timeout: optionFromConfig(
      command,
      'timeout',
      options.timeout,
      config.timeout === undefined ? undefined : String(config.timeout),
    ),
    wait: optionFromConfig(
      command,
      'wait',
      options.wait,
      config.wait === undefined ? undefined : String(config.wait),
    ),
    readySelector: optionFromConfig(
      command,
      'readySelector',
      options.readySelector,
      config.readySelector,
    ),
    suppressions: config.ignore,
  };
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

function renderIssue(issue: Issue): string {
  if (issue.type === 'fixed-element-collision') {
    return (
      `${truncate(issue.selector, 42)} overlaps ${truncate(issue.otherSelector, 42)} | ` +
      `${issue.overlapWidthPx}x${issue.overlapHeightPx}px`
    );
  }

  if (issue.type === 'fixed-content-occlusion') {
    return (
      `${truncate(issue.selector, 38)} covers ${truncate(issue.targetSelector, 38)} | ` +
      `${issue.targetCoveragePct}% (${issue.overlapWidthPx}x${issue.overlapHeightPx}px)`
    );
  }

  return `${truncate(issue.selector, 60)} overflows ${issue.side} by ${issue.overflowPx}px`;
}

function renderTable(
  url: string,
  viewports: ViewportResult[],
  rootCauses: RootCause[],
  boundaries: BoundaryDisplay[],
  outputPath: string,
  durationMs: number,
): void {
  const colors = pc.createColors(Boolean(process.stdout.isTTY) && !process.env.NO_COLOR);

  process.stdout.write(`\n  Slice | ${url}\n\n`);

  for (const viewport of viewports) {
    const width = String(viewport.width).padEnd(6, ' ');

    if (viewport.status === 'pass') {
      const suppressed =
        viewport.suppressedIssues.length > 0
          ? ` | ${viewport.suppressedIssues.length} suppressed`
          : '';
      process.stdout.write(`  ${width}${colors.green('PASS')}${suppressed}\n`);
      continue;
    }

    const rootsAtWidth = rootCauses
      .map((rootCause) => ({
        rootCause,
        observation: rootCause.observations.find(
          (observation) => observation.viewportWidth === viewport.width,
        ),
      }))
      .filter(
        (
          entry,
        ): entry is {
          rootCause: RootCause;
          observation: RootCauseObservation;
        } => entry.observation !== undefined,
      );

    const groupedIssueIds = new Set(
      rootsAtWidth.flatMap(({ observation }) => observation.issueIds),
    );
    const ungroupedIssues = viewport.issues.filter((issue) => !groupedIssueIds.has(issue.id));

    if (rootsAtWidth.length === 0) {
      const [first, ...rest] = viewport.issues;
      if (!first) {
        process.stdout.write(`  ${width}${colors.red('FAIL')}\n`);
        continue;
      }

      process.stdout.write(`  ${width}${colors.red('FAIL')}  ${renderIssue(first)}\n`);
      for (const issue of rest) {
        process.stdout.write(`        ${renderIssue(issue)}\n`);
      }
      continue;
    }

    let firstLine = true;

    for (const { rootCause, observation } of rootsAtWidth) {
      const text =
        `${truncate(rootCause.selector, 60)} overflows ${rootCause.side} by ` +
        `${observation.overflowPx}px | ${observation.issueIds.length} affected elements`;

      if (firstLine) {
        process.stdout.write(`  ${width}${colors.red('FAIL')}  ${text}\n`);
        firstLine = false;
      } else {
        process.stdout.write(`        ${text}\n`);
      }

      if (rootCause.diagnosis) {
        process.stdout.write(
          `        reason: ${rootCause.diagnosis.property}: ${rootCause.diagnosis.value} | ` +
            `${observation.computedWidthPx}px wide vs ${observation.availableWidthPx}px available\n`,
        );
      }

      const evidence = viewport.issues.filter(
        (issue): issue is HorizontalOverflowIssue =>
          issue.type === 'horizontal-overflow' && issue.rootCauseId === rootCause.id,
      );
      for (const issue of evidence.slice(0, 2)) {
        process.stdout.write(`        evidence: ${renderIssue(issue)}\n`);
      }
      if (evidence.length > 2) {
        process.stdout.write(`        evidence: +${evidence.length - 2} more\n`);
      }
    }

    for (const issue of ungroupedIssues) {
      if (firstLine) {
        process.stdout.write(`  ${width}${colors.red('FAIL')}  ${renderIssue(issue)}\n`);
        firstLine = false;
      } else {
        process.stdout.write(`        ${renderIssue(issue)}\n`);
      }
    }
  }

  if (rootCauses.length > 0) {
    process.stdout.write('\n  Root causes\n');

    for (const rootCause of rootCauses) {
      const boundaryText =
        rootCause.boundaries.length === 1
          ? ` | breaks at ${rootCause.boundaries[0]?.boundary}px`
          : rootCause.boundaries.length > 1
            ? ` | boundaries ${rootCause.boundaries
                .map((boundary) => `${boundary.boundary}px`)
                .join(', ')}`
            : '';

      process.stdout.write(
        `    ${rootCause.id}  ${rootCause.selector}${boundaryText} | ` +
          `${rootCause.issueIds.length} evidence selectors\n`,
      );

      if (rootCause.diagnosis) {
        process.stdout.write(
          `          reason: ${rootCause.diagnosis.property}: ${rootCause.diagnosis.value}\n`,
        );

        if (rootCause.diagnosis.source) {
          const sourceName = rootCause.diagnosis.source.stylesheet ?? '<inline stylesheet>';
          process.stdout.write(
            `          source: ${rootCause.diagnosis.source.selector} @ ${sourceName}\n`,
          );
        }

        process.stdout.write(`          likely fix: ${rootCause.diagnosis.suggestion}\n`);
      }
    }
  }

  const groupedBoundaryIssueIds = new Set(rootCauses.flatMap((rootCause) => rootCause.issueIds));
  const standaloneBoundaries = boundaries.filter(
    ({ result }) => !groupedBoundaryIssueIds.has(result.issueId),
  );

  if (standaloneBoundaries.length > 0) {
    process.stdout.write('\n  Boundaries\n');

    for (const boundary of standaloneBoundaries) {
      const { result } = boundary;
      const low = Math.min(boundary.rangeStart, boundary.rangeEnd);
      const high = Math.max(boundary.rangeStart, boundary.rangeEnd);
      process.stdout.write(
        `    ${result.issueId}  ${result.issueType} | breaks at ${result.boundary}px  ` +
          `(${result.probesUsed} probes, range ${low}-${high})\n`,
      );
    }
  }

  const failures = viewports.filter((viewport) => viewport.status === 'fail').length;
  const suppressed = viewports.reduce((sum, viewport) => sum + viewport.suppressedIssues.length, 0);
  const suppressedText = suppressed > 0 ? ` | ${suppressed} suppressed` : '';
  process.stdout.write(
    `\n  ${failures} failures in ${viewports.length} viewports | ` +
      `${(durationMs / 1000).toFixed(1)}s${suppressedText}\n`,
  );
  process.stdout.write(`  ${outputPath}\n\n`);
}

function issueKey(selector: string, side: 'right' | 'left'): string {
  return `horizontal-overflow|${side}|${selector}`;
}

function collisionIssueKey(firstSelector: string, secondSelector: string): string {
  const selectors = [firstSelector, secondSelector].sort();
  return `fixed-element-collision|${selectors[0]}|${selectors[1]}`;
}

function occlusionIssueKey(selector: string, targetSelector: string): string {
  return `fixed-content-occlusion|${selector}|${targetSelector}`;
}

function rootCauseKey(selector: string, side: 'right' | 'left'): string {
  return `horizontal-overflow-root|${side}|${selector}`;
}

async function enrichIssues(
  page: Page,
  surface: SurfaceSnapshot<LayoutNode>,
  metrics: DocumentMetrics,
  issueIds: Map<string, string>,
  rootCauseIds: Map<string, string>,
): Promise<RawCaptureResult> {
  const nodes = surface.nodes;
  const { width: viewportWidth } = surface.viewport;
  const detected = documentOverflowsHorizontally(metrics)
    ? await runDetector(horizontalOverflowDetector, surface)
    : [];
  const collisions = await runDetector(fixedElementCollisionDetector, surface);
  const occlusions = await runDetector(fixedContentOcclusionDetector, surface);
  const grouped = groupHorizontalOverflow(nodes, surface.viewport, detected);
  const byIndex = new Map(nodes.map((node) => [node.index, node]));
  const isUnique = makePageUniquenessCheck((selector) =>
    page.evaluate((value) => document.querySelectorAll(value).length, selector),
  );
  const rootCauseByLeaf = new Map<number, { id: string; captured: CapturedRootCause }>();

  for (const group of grouped) {
    const root = byIndex.get(group.rootNodeIndex);
    if (!root) continue;

    const selector = await buildStableSelector(root, nodes, isUnique);
    const key = rootCauseKey(selector, group.side);
    let id = rootCauseIds.get(key);

    if (!id) {
      id = `root-${rootCauseIds.size + 1}`;
      rootCauseIds.set(key, id);
    }

    const measurement = diagnoseHorizontalOverflowRoot(root, viewportWidth);
    let diagnosis: RootCauseDiagnosis | undefined;

    if (measurement.diagnosis) {
      const source = await findUniqueCssSource(
        page,
        selector,
        measurement.diagnosis.property,
        measurement.diagnosis.value,
      );

      if (measurement.diagnosis.kind === 'fixed-width-constraint') {
        if (source) {
          diagnosis = {
            ...measurement.diagnosis,
            source,
          };
        }
      } else {
        diagnosis = {
          ...measurement.diagnosis,
          source,
        };
      }
    }

    const captured: CapturedRootCause = {
      id,
      selector,
      tagName: group.tagName,
      side: group.side,
      viewportWidth,
      overflowPx: group.overflowPx,
      bbox: group.bbox,
      issueIds: [],
      computedWidthPx: measurement.computedWidthPx,
      availableWidthPx: measurement.availableWidthPx,
      ...(diagnosis ? { diagnosis } : {}),
    };

    for (const leafNodeIndex of group.leafNodeIndices) {
      rootCauseByLeaf.set(leafNodeIndex, { id, captured });
    }
  }

  const issues: Issue[] = [];
  const issueIdByNode = new Map<number, string>();

  for (const finding of detected) {
    const node = byIndex.get(finding.nodeIndex);
    if (!node) continue;

    const selector = await buildStableSelector(node, nodes, isUnique);
    const key = issueKey(selector, finding.side);
    let id = issueIds.get(key);

    if (!id) {
      id = `issue-${issueIds.size + 1}`;
      issueIds.set(key, id);
    }

    issueIdByNode.set(finding.nodeIndex, id);
    const rootCauseId = rootCauseByLeaf.get(finding.nodeIndex)?.id;

    issues.push({
      id,
      type: 'horizontal-overflow',
      severity: 'error',
      selector,
      tagName: finding.tagName,
      side: finding.side,
      overflowPx: finding.overflowPx,
      bbox: finding.bbox,
      viewportWidth,
      ...(rootCauseId ? { rootCauseId } : {}),
      evidence: {
        documentScrollWidth: metrics.scrollWidth,
        documentClientWidth: metrics.clientWidth,
        elementRight: node.rect.x + node.rect.width,
        computedStyles: {
          display: node.styles.display ?? '',
          position: node.styles.position ?? '',
          'overflow-x': node.styles['overflow-x'] ?? '',
        },
        nearestScrollableAncestor: null,
      },
    });
  }

  for (const collision of collisions) {
    const firstNode = byIndex.get(collision.firstNodeIndex);
    const secondNode = byIndex.get(collision.secondNodeIndex);
    if (!firstNode || !secondNode) continue;

    const firstSelector = await buildStableSelector(firstNode, nodes, isUnique);
    const secondSelector = await buildStableSelector(secondNode, nodes, isUnique);

    const ordered =
      firstSelector <= secondSelector
        ? {
            firstNode,
            secondNode,
            firstSelector,
            secondSelector,
            firstBbox: collision.firstBbox,
            secondBbox: collision.secondBbox,
          }
        : {
            firstNode: secondNode,
            secondNode: firstNode,
            firstSelector: secondSelector,
            secondSelector: firstSelector,
            firstBbox: collision.secondBbox,
            secondBbox: collision.firstBbox,
          };

    const key = collisionIssueKey(ordered.firstSelector, ordered.secondSelector);
    let id = issueIds.get(key);

    if (!id) {
      id = `issue-${issueIds.size + 1}`;
      issueIds.set(key, id);
    }

    issues.push({
      id,
      type: 'fixed-element-collision',
      severity: 'error',
      selector: ordered.firstSelector,
      otherSelector: ordered.secondSelector,
      tagName: ordered.firstNode.tagName,
      otherTagName: ordered.secondNode.tagName,
      overlapWidthPx: collision.overlapWidthPx,
      overlapHeightPx: collision.overlapHeightPx,
      overlapAreaPx: collision.overlapAreaPx,
      bbox: ordered.firstBbox,
      otherBbox: ordered.secondBbox,
      viewportWidth,
      evidence: {
        position: 'fixed',
        otherPosition: 'fixed',
        zIndex: ordered.firstNode.styles['z-index'] ?? '',
        otherZIndex: ordered.secondNode.styles['z-index'] ?? '',
      },
    });
  }

  for (const occlusion of occlusions) {
    const occluderNode = byIndex.get(occlusion.occluderNodeIndex);
    const targetNode = byIndex.get(occlusion.targetNodeIndex);
    if (!occluderNode || !targetNode) continue;

    const selector = await buildStableSelector(occluderNode, nodes, isUnique);
    const targetSelector = await buildStableSelector(targetNode, nodes, isUnique);
    const key = occlusionIssueKey(selector, targetSelector);
    let id = issueIds.get(key);

    if (!id) {
      id = `issue-${issueIds.size + 1}`;
      issueIds.set(key, id);
    }

    issues.push({
      id,
      type: 'fixed-content-occlusion',
      severity: 'error',
      selector,
      targetSelector,
      tagName: occluderNode.tagName,
      targetTagName: targetNode.tagName,
      overlapWidthPx: occlusion.overlapWidthPx,
      overlapHeightPx: occlusion.overlapHeightPx,
      overlapAreaPx: occlusion.overlapAreaPx,
      targetCoveragePct: occlusion.targetCoveragePct,
      bbox: occlusion.occluderBbox,
      targetBbox: occlusion.targetBbox,
      viewportWidth,
      evidence: {
        position: 'fixed',
        targetPosition: targetNode.styles.position ?? '',
        zIndex: occluderNode.styles['z-index'] ?? '',
        targetZIndex: targetNode.styles['z-index'] ?? '',
        paintOrder: occlusion.occluderPaintOrder,
        targetPaintOrder: occlusion.targetPaintOrder,
      },
    });
  }

  const rootCauses = [
    ...new Map(
      [...rootCauseByLeaf.values()].map(({ captured }) => [captured.id, captured]),
    ).values(),
  ];

  for (const rootCause of rootCauses) {
    rootCause.issueIds = detected
      .filter((finding) => rootCauseByLeaf.get(finding.nodeIndex)?.id === rootCause.id)
      .map((finding) => issueIdByNode.get(finding.nodeIndex))
      .filter((id): id is string => id !== undefined);
  }

  return {
    issues,
    rootCauses: rootCauses.filter(
      (rootCause) => rootCause.issueIds.length >= 2 || rootCause.diagnosis !== undefined,
    ),
  };
}

async function captureAtWidth(
  width: number,
  height: number,
  waitMs: number,
  runtime: Awaited<ReturnType<typeof launchBrowser>>,
  issueIds: Map<string, string>,
  rootCauseIds: Map<string, string>,
  suppressions: SuppressionRule[],
): Promise<CaptureResult> {
  await stabilizeViewport(runtime.page, width, height, waitMs);
  const metrics = await getDocumentMetrics(runtime.page);
  const surface = await captureBrowserSurface(runtime.cdp, { width, height });
  const captured = await enrichIssues(runtime.page, surface, metrics, issueIds, rootCauseIds);
  const { issues, suppressedIssues } = partitionSuppressedIssues(captured.issues, suppressions);
  const activeIssueIds = new Set(issues.map((issue) => issue.id));
  const rootCauses = captured.rootCauses
    .map((rootCause) => ({
      ...rootCause,
      issueIds: rootCause.issueIds.filter((issueId) => activeIssueIds.has(issueId)),
    }))
    .filter(
      (rootCause) =>
        rootCause.issueIds.length > 0 &&
        (rootCause.issueIds.length >= 2 || rootCause.diagnosis !== undefined),
    );

  return {
    issues,
    suppressedIssues,
    rootCauses,
  };
}

function aggregateRootCauses(
  observations: CapturedRootCause[],
  boundaries: RootCauseBoundaryResult[],
): RootCause[] {
  const byId = new Map<
    string,
    {
      id: string;
      selector: string;
      tagName: string;
      side: 'right' | 'left';
      issueIds: Set<string>;
      observations: RootCauseObservation[];
      diagnosis?: RootCauseDiagnosis;
    }
  >();

  for (const observation of observations) {
    let aggregate = byId.get(observation.id);

    if (!aggregate) {
      aggregate = {
        id: observation.id,
        selector: observation.selector,
        tagName: observation.tagName,
        side: observation.side,
        issueIds: new Set(),
        observations: [],
        ...(observation.diagnosis ? { diagnosis: observation.diagnosis } : {}),
      };
      byId.set(observation.id, aggregate);
    }

    observation.issueIds.forEach((issueId) => aggregate.issueIds.add(issueId));
    if (!aggregate.diagnosis && observation.diagnosis) {
      aggregate.diagnosis = observation.diagnosis;
    }
    aggregate.observations.push({
      viewportWidth: observation.viewportWidth,
      overflowPx: observation.overflowPx,
      bbox: observation.bbox,
      issueIds: observation.issueIds,
      computedWidthPx: observation.computedWidthPx,
      availableWidthPx: observation.availableWidthPx,
    });
  }

  return [...byId.values()].map((aggregate) => {
    const boundaryByKey = new Map<string, RootCauseBoundary>();

    for (const boundary of boundaries) {
      if (boundary.rootCauseId !== aggregate.id) continue;

      const key =
        `${boundary.boundary}|${boundary.lastGoodWidth}|${boundary.firstBadWidth}|` +
        `${boundary.probesUsed}`;

      boundaryByKey.set(key, {
        boundary: boundary.boundary,
        lastGoodWidth: boundary.lastGoodWidth,
        firstBadWidth: boundary.firstBadWidth,
        probesUsed: boundary.probesUsed,
      });
    }

    return {
      id: aggregate.id,
      type: 'horizontal-overflow' as const,
      severity: 'error' as const,
      selector: aggregate.selector,
      tagName: aggregate.tagName,
      side: aggregate.side,
      issueIds: [...aggregate.issueIds],
      observations: aggregate.observations,
      boundaries: [...boundaryByKey.values()],
      ...(aggregate.diagnosis ? { diagnosis: aggregate.diagnosis } : {}),
    };
  });
}

async function runSlice(url: string, options: RunOptions): Promise<number> {
  const widths = parseWidths(options.widths);
  const height = parsePositiveInteger(options.height, '--height');
  const timeout = parsePositiveInteger(options.timeout, '--timeout');
  const waitMs = parsePositiveInteger(options.wait, '--wait', true);
  const startedAt = Date.now();

  const runtime = await launchBrowser({
    width: widths[0] ?? 320,
    height,
  });

  const viewports: ViewportResult[] = [];
  const issueIds = new Map<string, string>();
  const rootCauseIds = new Map<string, string>();
  const rootCauseObservations: CapturedRootCause[] = [];
  const sampleCaptures = new Map<number, CaptureResult>();

  try {
    await installStabilization(runtime.context);
    await runtime.page.goto(url, { timeout });

    if (options.readySelector) {
      await runtime.page.waitForSelector(options.readySelector, {
        state: 'visible',
        timeout,
      });
    }

    for (const width of widths) {
      const captured = await captureAtWidth(
        width,
        height,
        waitMs,
        runtime,
        issueIds,
        rootCauseIds,
        options.suppressions,
      );
      sampleCaptures.set(width, captured);
      rootCauseObservations.push(...captured.rootCauses);

      viewports.push({
        width,
        height,
        status: captured.issues.length > 0 ? 'fail' : 'pass',
        issues: captured.issues,
        suppressedIssues: captured.suppressedIssues,
      });
    }

    const boundaries: BoundaryResult[] = [];
    const rootCauseBoundaries: RootCauseBoundaryResult[] = [];
    const boundaryDisplays: BoundaryDisplay[] = [];

    if (options.boundary) {
      const boundaryCaptureCache = new Map(sampleCaptures);
      const rootCauseWidthsRecorded = new Set(widths);

      const captureBoundaryWidth = async (width: number): Promise<CaptureResult> => {
        const cached = boundaryCaptureCache.get(width);
        if (cached) return cached;

        const captured = await captureAtWidth(
          width,
          height,
          waitMs,
          runtime,
          issueIds,
          rootCauseIds,
          options.suppressions,
        );
        boundaryCaptureCache.set(width, captured);
        return captured;
      };

      const recordRootCauseObservations = (width: number, captured: CaptureResult): void => {
        if (rootCauseWidthsRecorded.has(width)) return;
        rootCauseObservations.push(...captured.rootCauses);
        rootCauseWidthsRecorded.add(width);
      };

      for (let index = 0; index < viewports.length - 1; index += 1) {
        const current = viewports[index];
        const next = viewports[index + 1];
        if (!current || !next) continue;

        const currentIssueIds = new Set(current.issues.map((issue) => issue.id));
        const nextIssueIds = new Set(next.issues.map((issue) => issue.id));
        const transitionIssueIds = [...new Set([...currentIssueIds, ...nextIssueIds])].filter(
          (issueId) => currentIssueIds.has(issueId) !== nextIssueIds.has(issueId),
        );

        for (const issueId of transitionIssueIds) {
          const issue =
            current.issues.find((candidate) => candidate.id === issueId) ??
            next.issues.find((candidate) => candidate.id === issueId);
          if (!issue) continue;

          const currentBroken = currentIssueIds.has(issueId);
          const passWidth = currentBroken ? next.width : current.width;
          const failWidth = currentBroken ? current.width : next.width;

          const search = await findBoundary(
            async (width) => {
              const captured = await captureBoundaryWidth(width);
              return captured.issues.some((candidate) => candidate.id === issueId);
            },
            passWidth,
            failWidth,
          );

          const capturedAtBoundary = await captureBoundaryWidth(search.firstBadWidth);
          recordRootCauseObservations(search.firstBadWidth, capturedAtBoundary);

          const result: BoundaryResult = {
            issueId,
            issueType: issue.type,
            boundary: search.boundary,
            lastGoodWidth: search.lastGoodWidth,
            firstBadWidth: search.firstBadWidth,
            probesUsed: search.probesUsed,
          };

          boundaries.push(result);
          boundaryDisplays.push({
            result,
            rangeStart: current.width,
            rangeEnd: next.width,
          });
        }

        const currentCapture = sampleCaptures.get(current.width);
        const nextCapture = sampleCaptures.get(next.width);
        if (!currentCapture || !nextCapture) continue;

        const currentRootCauseIds = new Set(
          currentCapture.rootCauses.map((rootCause) => rootCause.id),
        );
        const nextRootCauseIds = new Set(nextCapture.rootCauses.map((rootCause) => rootCause.id));
        const transitionRootCauseIds = [
          ...new Set([...currentRootCauseIds, ...nextRootCauseIds]),
        ].filter(
          (rootCauseId) =>
            currentRootCauseIds.has(rootCauseId) !== nextRootCauseIds.has(rootCauseId),
        );

        for (const rootCauseId of transitionRootCauseIds) {
          const currentBroken = currentRootCauseIds.has(rootCauseId);
          const passWidth = currentBroken ? next.width : current.width;
          const failWidth = currentBroken ? current.width : next.width;

          const search = await findBoundary(
            async (width) => {
              const captured = await captureBoundaryWidth(width);
              return captured.rootCauses.some((rootCause) => rootCause.id === rootCauseId);
            },
            passWidth,
            failWidth,
          );

          const capturedAtBoundary = await captureBoundaryWidth(search.firstBadWidth);
          recordRootCauseObservations(search.firstBadWidth, capturedAtBoundary);

          rootCauseBoundaries.push({
            rootCauseId,
            boundary: search.boundary,
            lastGoodWidth: search.lastGoodWidth,
            firstBadWidth: search.firstBadWidth,
            probesUsed: search.probesUsed,
          });
        }
      }
    }

    const rootCauses = aggregateRootCauses(rootCauseObservations, rootCauseBoundaries);
    const durationMs = Date.now() - startedAt;
    const failed = viewports.filter((viewport) => viewport.status === 'fail').length;
    const results: SliceResults = {
      version: 1,
      url,
      timestamp: new Date().toISOString(),
      userAgent: `Chromium/${runtime.browser.version()}`,
      summary: {
        viewportsChecked: viewports.length,
        passed: viewports.length - failed,
        failed,
        totalIssues: viewports.reduce((sum, viewport) => sum + viewport.issues.length, 0),
        suppressedIssues: viewports.reduce(
          (sum, viewport) => sum + viewport.suppressedIssues.length,
          0,
        ),
        rootCauseGroups: rootCauses.length,
        durationMs,
      },
      viewports,
      boundaries,
      rootCauses,
    };

    const outputPath = await writeResults(options.out, results);

    if (options.json) {
      process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
    } else {
      renderTable(url, viewports, rootCauses, boundaryDisplays, outputPath, durationMs);
    }

    return failed > 0 ? 1 : 0;
  } finally {
    await runtime.browser.close();
  }
}

const program = new Command();

program
  .name('slice')
  .description('Deterministic responsive QA for coding agents')
  .argument('<url>', 'page URL to inspect')
  .option('--widths <list>', 'viewport widths separated by commas', DEFAULT_WIDTHS.join(','))
  .option('--height <n>', 'viewport height', String(DEFAULT_HEIGHT))
  .option('--out <dir>', 'artifact output directory', DEFAULT_OUT_DIR)
  .option('--json', 'print JSON to stdout instead of the table', false)
  .option('--no-boundary', 'skip binary boundary search')
  .option('--timeout <ms>', 'page load timeout', String(DEFAULT_TIMEOUT_MS))
  .option('--wait <ms>', 'delay after resize', String(DEFAULT_WAIT_MS))
  .option('--ready-selector <selector>', 'require a visible selector before scanning')
  .option('--config <path>', 'project config path; defaults to slice.config.json when present')
  .exitOverride()
  .action(async (url: string, options: CliOptions, command: Command) => {
    const loaded = await loadSliceConfig(options.config);
    const resolved = resolveRunOptions(command, options, loaded.config);
    process.exitCode = await runSlice(url, resolved);
  });

try {
  await program.parseAsync();
} catch (error) {
  if (error instanceof CommanderError && error.exitCode === 0) {
    process.exitCode = 0;
  } else {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Slice: ${message}\n`);
    process.exitCode = 2;
  }
}
