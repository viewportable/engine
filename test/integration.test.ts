import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(here, 'fixtures');
const cliPath = path.resolve(here, '../dist/cli.mjs');

let server: Server;
let baseUrl: string;
let tempDirs: string[] = [];

async function startFixtureServer(): Promise<{ server: Server; baseUrl: string }> {
  const instance = createServer(async (request, response) => {
    const fixture = path.basename(request.url ?? '/clean.html');
    const filePath = path.join(fixturesDir, fixture);

    try {
      const html = await readFile(filePath);
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(html);
    } catch {
      response.writeHead(404);
      response.end('Not found');
    }
  });

  await new Promise<void>((resolve) => instance.listen(0, '127.0.0.1', resolve));
  const address = instance.address();
  if (!address || typeof address === 'string') throw new Error('Fixture server did not bind');

  return {
    server: instance,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

async function makeOutDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'slice-test-'));
  tempDirs.push(dir);
  return dir;
}

async function runCli(
  fixture: string,
  args: string[],
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cliPath, `${baseUrl}/${fixture}`, ...args], {
      env: { ...process.env, NO_COLOR: '1' },
    });

    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

beforeEach(async () => {
  const started = await startFixtureServer();
  server = started.server;
  baseUrl = started.baseUrl;
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });

  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs = [];
});

describe('slice CLI', () => {
  it('returns exit 0 and empty issues for a clean page', async () => {
    const out = await makeOutDir();
    const result = await runCli('clean.html', [
      '--widths',
      '320,390',
      '--wait',
      '0',
      '--no-boundary',
      '--out',
      out,
    ]);

    expect(result.code).toBe(0);
    const report = JSON.parse(await readFile(path.join(out, 'results.json'), 'utf8'));
    expect(
      report.viewports.every((viewport: { issues: unknown[] }) => viewport.issues.length === 0),
    ).toBe(true);
  });

  it('detects one sibling wrapping below a previously stable row', async () => {
    const out = await makeOutDir();
    const result = await runCli('wrapping.html', [
      '--widths',
      '320,430',
      '--wait',
      '0',
      '--no-boundary',
      '--out',
      out,
    ]);

    expect(result.code).toBe(1);
    const report = JSON.parse(await readFile(path.join(out, 'results.json'), 'utf8'));
    const narrow = report.viewports.find((viewport: { width: number }) => viewport.width === 320);
    const wide = report.viewports.find((viewport: { width: number }) => viewport.width === 430);

    expect(wide.issues.filter((issue: { type: string }) => issue.type === 'wrapping')).toEqual([]);
    const wrappingIssues = narrow.issues.filter(
      (issue: { type: string }) => issue.type === 'wrapping',
    );
    expect(wrappingIssues).toEqual([
      expect.objectContaining({
        type: 'wrapping',
        selector: '#item-4',
        parentSelector: '#actions',
        viewportWidth: 320,
        previousViewportWidth: 430,
        evidence: expect.objectContaining({
          previousRowSize: 4,
          currentRowSize: 1,
          stableSiblingCount: 3,
          parentDisplay: 'flex',
          parentFlexWrap: 'wrap',
        }),
      }),
    ]);
    expect(report.rootCauses).toEqual([
      expect.objectContaining({
        type: 'wrapping',
        selector: '#actions',
        issueIds: [wrappingIssues[0].id],
        evidence: {
          authoredFlexWrap: true,
          transitionCount: 1,
          repeatedAcrossWidths: false,
          displayValues: ['flex'],
          flexWrapValues: ['wrap'],
        },
        assessment: {
          classification: 'authored-reflow-candidate',
          reasons: ['explicit-flex-wrap'],
        },
      }),
    ]);
    expect(wrappingIssues[0].rootCauseId).toBe(report.rootCauses[0].id);
    expect(result.stdout).toContain(
      '#actions wraps 1 sibling | 3 stay | review: authored reflow candidate',
    );
    expect(result.stdout).toContain('review: authored reflow candidate; finding remains active');
  });

  it('detects the final inline footer item wrapping onto a second row', async () => {
    const out = await makeOutDir();
    const result = await runCli('wrapping-inline-footer.html', [
      '--widths',
      '335,375',
      '--wait',
      '0',
      '--no-boundary',
      '--out',
      out,
    ]);

    expect(result.code).toBe(1);
    const report = JSON.parse(await readFile(path.join(out, 'results.json'), 'utf8'));
    const narrow = report.viewports.find((viewport: { width: number }) => viewport.width === 335);

    const wrappingIssues = narrow.issues.filter(
      (issue: { type: string }) => issue.type === 'wrapping',
    );
    expect(wrappingIssues).toEqual([
      expect.objectContaining({
        type: 'wrapping',
        selector: '#terms',
        parentSelector: '#mobile-footer',
        viewportWidth: 335,
        previousViewportWidth: 375,
        evidence: expect.objectContaining({
          previousRowSize: 5,
          currentRowSize: 1,
          stableSiblingCount: 4,
          parentDisplay: 'block',
          parentFlexWrap: 'nowrap',
        }),
      }),
    ]);
    expect(report.rootCauses).toEqual([
      expect.objectContaining({
        type: 'wrapping',
        selector: '#mobile-footer',
        issueIds: [wrappingIssues[0].id],
        evidence: expect.objectContaining({
          authoredFlexWrap: false,
          transitionCount: 1,
          repeatedAcrossWidths: false,
        }),
        assessment: {
          classification: 'unclassified',
          reasons: [],
        },
      }),
    ]);
  });

  it('writes opt-in small-range overlap research without changing scan status', async () => {
    const out = await makeOutDir();
    const result = await runCli('small-range-overlap.html', [
      '--widths',
      '389,390,391,392',
      '--wait',
      '0',
      '--no-boundary',
      '--research-small-range-overlap',
      '--out',
      out,
    ]);

    expect(result.code).toBe(0);
    const research = JSON.parse(await readFile(path.join(out, 'small-range-overlap.json'), 'utf8'));

    expect(research).toEqual({
      version: 1,
      widths: [389, 390, 391, 392],
      candidates: [
        expect.objectContaining({
          parentLabel: 'div#row',
          firstLabel: 'div#first.item',
          secondLabel: 'div#second.item',
          interval: {
            state: 'overlap',
            minSampleWidth: 390,
            maxSampleWidth: 391,
            sampleWidths: [390, 391],
            sampleCount: 2,
          },
          sampledSpanPx: 1,
        }),
      ],
    });
  });

  it('attributes nested overflow to exactly one deepest element', async () => {
    const out = await makeOutDir();
    const result = await runCli('nested.html', [
      '--widths',
      '390',
      '--wait',
      '0',
      '--no-boundary',
      '--out',
      out,
    ]);

    expect(result.code).toBe(1);
    const report = JSON.parse(await readFile(path.join(out, 'results.json'), 'utf8'));
    expect(report.viewports[0].issues).toHaveLength(1);
    expect(report.viewports[0].issues[0].selector).toContain('culprit');
  });

  it('finds the exact 712px boundary', async () => {
    const out = await makeOutDir();
    const result = await runCli('boundary.html', [
      '--widths',
      '700,720',
      '--wait',
      '0',
      '--out',
      out,
    ]);

    expect(result.code).toBe(1);
    const report = JSON.parse(await readFile(path.join(out, 'results.json'), 'utf8'));
    expect(report.boundaries[0].boundary).toBe(712);
  });

  it('uses the same 1px tolerance for viewport status and boundary search', async () => {
    const out = await makeOutDir();
    const result = await runCli('tolerance-boundary.html', [
      '--widths',
      '399,400,401',
      '--wait',
      '0',
      '--out',
      out,
    ]);

    expect(result.code).toBe(1);
    const report = JSON.parse(await readFile(path.join(out, 'results.json'), 'utf8'));

    expect(
      report.viewports.map((viewport: { width: number; status: string }) => [
        viewport.width,
        viewport.status,
      ]),
    ).toEqual([
      [399, 'fail'],
      [400, 'pass'],
      [401, 'pass'],
    ]);
    expect(report.boundaries[0]).toMatchObject({
      issueType: 'horizontal-overflow',
      boundary: 399,
      lastGoodWidth: 400,
      firstBadWidth: 399,
    });
  });

  it('groups sibling manifestations under one layout root cause', async () => {
    const out = await makeOutDir();
    const result = await runCli('grouped-grid.html', [
      '--widths',
      '390,720',
      '--wait',
      '0',
      '--out',
      out,
    ]);

    expect(result.code).toBe(1);
    const report = JSON.parse(await readFile(path.join(out, 'results.json'), 'utf8'));

    expect(report.rootCauses).toHaveLength(1);
    expect(report.rootCauses[0].selector).toBe('section.grid');
    expect(report.rootCauses[0].issueIds.length).toBeGreaterThanOrEqual(2);
    expect(report.summary.rootCauseGroups).toBe(1);
    expect(report.rootCauses[0].diagnosis).toMatchObject({
      kind: 'min-width-constraint',
      property: 'min-width',
      value: '700px',
      source: {
        stylesheet: null,
        selector: 'section.grid',
        property: 'min-width',
        value: '700px',
      },
    });
    expect(report.rootCauses[0].observations[0]).toMatchObject({
      computedWidthPx: 700,
      availableWidthPx: 390,
    });
    expect(report.rootCauses[0].boundaries).toEqual([
      expect.objectContaining({
        boundary: 698,
        lastGoodWidth: 699,
        firstBadWidth: 698,
      }),
    ]);
    expect(
      report.viewports[0].issues.every(
        (issue: { rootCauseId?: string }) => issue.rootCauseId === report.rootCauses[0].id,
      ),
    ).toBe(true);
    expect(result.stdout).toContain('section.grid');
    expect(result.stdout).toContain('affected elements');
    expect(result.stdout).toContain('reason: min-width: 700px');
    expect(result.stdout).toContain('source: section.grid @ <inline stylesheet>');
    expect(result.stdout).not.toContain('Â');
  });

  it('diagnoses an authored fixed width on a grouped layout root', async () => {
    const out = await makeOutDir();
    const result = await runCli('fixed-width-root.html', [
      '--widths',
      '390,720',
      '--wait',
      '0',
      '--out',
      out,
    ]);

    expect(result.code).toBe(1);
    const report = JSON.parse(await readFile(path.join(out, 'results.json'), 'utf8'));

    expect(report.rootCauses).toHaveLength(1);
    expect(report.rootCauses[0]).toMatchObject({
      selector: 'section.fixed-grid',
      diagnosis: {
        kind: 'fixed-width-constraint',
        property: 'width',
        value: '700px',
        source: {
          stylesheet: null,
          selector: '.fixed-grid',
          property: 'width',
          value: '700px',
        },
      },
    });
    expect(report.rootCauses[0].boundaries).toEqual([
      expect.objectContaining({
        boundary: 698,
        lastGoodWidth: 699,
        firstBadWidth: 698,
      }),
    ]);
    expect(result.stdout).toContain('reason: width: 700px');
    expect(result.stdout).toContain('source: .fixed-grid @ <inline stylesheet>');
  });

  it('keeps clipping ancestry across non-layout DOM nodes', async () => {
    const out = await makeOutDir();
    const result = await runCli('non-layout-ancestor-overflow.html', [
      '--widths',
      '390',
      '--wait',
      '0',
      '--no-boundary',
      '--out',
      out,
    ]);

    expect(result.code).toBe(0);
    const report = JSON.parse(await readFile(path.join(out, 'results.json'), 'utf8'));
    expect(report.viewports[0]).toMatchObject({
      width: 390,
      status: 'pass',
      issues: [],
    });
  });

  it('reports a sibling that wraps away from a stable row', async () => {
    const out = await makeOutDir();
    const result = await runCli('wrapping-anomaly.html', [
      '--widths',
      '430,320',
      '--wait',
      '0',
      '--no-boundary',
      '--out',
      out,
    ]);

    expect(result.code).toBe(1);
    const report = JSON.parse(await readFile(path.join(out, 'results.json'), 'utf8'));
    const wide = report.viewports.find((viewport: { width: number }) => viewport.width === 430);
    const narrow = report.viewports.find((viewport: { width: number }) => viewport.width === 320);

    expect(wide).toMatchObject({ status: 'pass', issues: [] });
    const wrappingIssues = narrow.issues.filter(
      (issue: { type: string }) => issue.type === 'wrapping',
    );
    expect(wrappingIssues).toHaveLength(1);
    expect(wrappingIssues[0]).toMatchObject({
      type: 'wrapping',
      viewportWidth: 320,
      previousViewportWidth: 430,
      selector: 'a.wrapped',
      parentSelector: 'nav',
      evidence: {
        previousRowSize: 4,
        currentRowSize: 1,
        stableSiblingCount: 3,
      },
    });
    expect(wrappingIssues[0].rootCauseId).toBe(report.rootCauses[0].id);
    expect(report.rootCauses[0]).toMatchObject({
      type: 'wrapping',
      selector: 'nav',
      evidence: {
        authoredFlexWrap: true,
        transitionCount: 1,
        repeatedAcrossWidths: false,
      },
    });
    expect(result.stdout).toContain('nav wraps 1 sibling');
    expect(report.boundaries).toEqual([]);
  });

  it('reports an independent fixed-element collision without document overflow', async () => {
    const out = await makeOutDir();
    const result = await runCli('fixed-collision.html', [
      '--widths',
      '390',
      '--wait',
      '0',
      '--out',
      out,
    ]);

    expect(result.code).toBe(1);
    const report = JSON.parse(await readFile(path.join(out, 'results.json'), 'utf8'));
    expect(report.viewports[0].issues).toHaveLength(1);
    expect(report.viewports[0].issues[0]).toMatchObject({
      type: 'fixed-element-collision',
      overlapWidthPx: 80,
      overlapHeightPx: 40,
    });
    expect(result.stdout).toContain('overlaps');
    expect(report.boundaries).toEqual([]);
  });

  it('reports fixed content occlusion without document overflow', async () => {
    const out = await makeOutDir();
    const result = await runCli('fixed-occlusion.html', [
      '--widths',
      '390',
      '--wait',
      '0',
      '--out',
      out,
    ]);

    expect(result.code).toBe(1);
    const report = JSON.parse(await readFile(path.join(out, 'results.json'), 'utf8'));
    expect(report.viewports[0].issues).toHaveLength(1);
    expect(report.viewports[0].issues[0]).toMatchObject({
      type: 'fixed-content-occlusion',
      overlapWidthPx: 100,
      overlapHeightPx: 48,
      targetCoveragePct: 63,
    });
    expect(result.stdout).toContain('covers');
    expect(report.boundaries).toEqual([]);
  });

  it('finds a fixed-element collision boundary even when overflow exists at both sampled widths', async () => {
    const out = await makeOutDir();
    const result = await runCli('overlap-boundaries.html', [
      '--widths',
      '390,500',
      '--wait',
      '0',
      '--out',
      out,
    ]);

    expect(result.code).toBe(1);
    const report = JSON.parse(await readFile(path.join(out, 'results.json'), 'utf8'));

    expect(
      report.viewports.every((viewport: { issues: Array<{ type: string }> }) =>
        viewport.issues.some((issue) => issue.type === 'horizontal-overflow'),
      ),
    ).toBe(true);

    const collisionBoundary = report.boundaries.find(
      (boundary: { issueType: string }) => boundary.issueType === 'fixed-element-collision',
    );

    expect(collisionBoundary).toMatchObject({
      issueType: 'fixed-element-collision',
      boundary: 438,
      lastGoodWidth: 439,
      firstBadWidth: 438,
    });
  });

  it('finds the exact fixed-content occlusion breakpoint', async () => {
    const out = await makeOutDir();
    const result = await runCli('occlusion-boundary.html', [
      '--widths',
      '700,820',
      '--wait',
      '0',
      '--out',
      out,
    ]);

    expect(result.code).toBe(1);
    const report = JSON.parse(await readFile(path.join(out, 'results.json'), 'utf8'));
    const occlusionBoundary = report.boundaries.find(
      (boundary: { issueType: string }) => boundary.issueType === 'fixed-content-occlusion',
    );

    expect(occlusionBoundary).toMatchObject({
      issueType: 'fixed-content-occlusion',
      boundary: 768,
      lastGoodWidth: 769,
      firstBadWidth: 768,
    });
    expect(result.stdout).toContain('fixed-content-occlusion | breaks at 768px');
  });

  it('loads project config and retains suppressed findings as evidence', async () => {
    const workspace = await makeOutDir();
    const out = path.join(workspace, 'report');
    const configPath = path.join(workspace, 'slice.config.json');

    await writeFile(
      configPath,
      JSON.stringify({
        widths: [390],
        wait: 0,
        boundary: false,
        out,
        ignore: [
          {
            type: 'fixed-element-collision',
            selector: 'button.target-profile',
            otherSelector: 'button.role-shapes',
          },
        ],
      }),
      'utf8',
    );

    const result = await runCli('fixed-collision.html', ['--config', configPath]);

    expect(result.code).toBe(0);
    const report = JSON.parse(await readFile(path.join(out, 'results.json'), 'utf8'));
    expect(report.viewports).toHaveLength(1);
    expect(report.viewports[0]).toMatchObject({
      width: 390,
      status: 'pass',
      issues: [],
    });
    expect(report.viewports[0].suppressedIssues).toHaveLength(1);
    expect(report.viewports[0].suppressedIssues[0].type).toBe('fixed-element-collision');
    expect(report.summary.suppressedIssues).toBe(1);
    expect(result.stdout).toContain('PASS | 1 suppressed');
  });

  it('lets explicit CLI values override project config', async () => {
    const workspace = await makeOutDir();
    const out = path.join(workspace, 'report');
    const configPath = path.join(workspace, 'slice.config.json');

    await writeFile(
      configPath,
      JSON.stringify({
        widths: [390],
        wait: 0,
        boundary: false,
        out,
      }),
      'utf8',
    );

    const result = await runCli('clean.html', ['--config', configPath, '--widths', '320,390']);

    expect(result.code).toBe(0);
    const report = JSON.parse(await readFile(path.join(out, 'results.json'), 'utf8'));
    expect(report.viewports.map((viewport: { width: number }) => viewport.width)).toEqual([
      320, 390,
    ]);
  });

  it('is deterministic apart from timestamp and durationMs', async () => {
    const firstOut = await makeOutDir();
    const secondOut = await makeOutDir();

    await runCli('fixed-width.html', [
      '--widths',
      '390',
      '--wait',
      '0',
      '--no-boundary',
      '--out',
      firstOut,
    ]);
    await runCli('fixed-width.html', [
      '--widths',
      '390',
      '--wait',
      '0',
      '--no-boundary',
      '--out',
      secondOut,
    ]);

    const first = JSON.parse(await readFile(path.join(firstOut, 'results.json'), 'utf8'));
    const second = JSON.parse(await readFile(path.join(secondOut, 'results.json'), 'utf8'));
    first.timestamp = '<timestamp>';
    second.timestamp = '<timestamp>';
    first.summary.durationMs = 0;
    second.summary.durationMs = 0;

    expect(first).toEqual(second);
  });

  it('requires a visible ready selector before scanning', async () => {
    const out = await makeOutDir();
    const result = await runCli('clean.html', [
      '--widths',
      '390',
      '--wait',
      '0',
      '--no-boundary',
      '--ready-selector',
      'main',
      '--out',
      out,
    ]);

    expect(result.code).toBe(0);
    const report = JSON.parse(await readFile(path.join(out, 'results.json'), 'utf8'));
    expect(report.summary.viewportsChecked).toBe(1);
  });

  it('returns exit 2 and no report when the ready selector never appears', async () => {
    const out = await makeOutDir();
    const result = await runCli('clean.html', [
      '--widths',
      '390',
      '--wait',
      '0',
      '--timeout',
      '250',
      '--ready-selector',
      '[data-missing-ready-state]',
      '--out',
      out,
    ]);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain('Slice:');
    await expect(readFile(path.join(out, 'results.json'), 'utf8')).rejects.toThrow('ENOENT');
  });

  it('does not write a partial report when navigation fails', async () => {
    const out = await makeOutDir();
    const result = await new Promise<{ code: number | null; stderr: string }>((resolve) => {
      const child = spawn(process.execPath, [
        cliPath,
        'http://127.0.0.1:1',
        '--timeout',
        '250',
        '--out',
        out,
      ]);

      let stderr = '';
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk) => {
        stderr += chunk;
      });
      child.on('close', (code) => resolve({ code, stderr }));
    });

    expect(result.code).toBe(2);
    expect(result.stderr).toContain('Slice:');
    await expect(readFile(path.join(out, 'results.json'), 'utf8')).rejects.toThrow('ENOENT');
  });
});
