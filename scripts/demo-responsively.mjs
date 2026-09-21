import { spawn } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeDemoServer, startPreferredDemoServer } from './demo-server.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cliPath = path.join(root, 'dist', 'cli.mjs');
const outDir = path.join(root, '.slice', 'demo-responsively');
const widths = '320,390,430,742,743,744,768,1024';
const shouldOpenResponsively = !process.argv.includes('--no-open');
const shouldExitAfterScan = process.argv.includes('--once');

function run(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, options);
    child.once('error', () => resolve(127));
    child.once('close', (code) => resolve(code ?? 1));
  });
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function openResponsively(url) {
  const deepLink = 'responsively://' + url;

  if (process.platform === 'darwin') {
    const launchCode = await run('open', ['-a', 'ResponsivelyApp'], { stdio: 'ignore' });

    if (launchCode === 0) {
      await sleep(1200);

      const protocolCode = await run('open', [deepLink], { stdio: 'ignore' });
      if (protocolCode === 0) {
        return;
      }
    }

    const directCode = await run('open', ['-na', 'ResponsivelyApp', '--args', url], {
      stdio: 'ignore',
    });

    if (directCode === 0) {
      return;
    }
  } else if (process.platform === 'win32') {
    const code = await run('cmd', ['/c', 'start', '', deepLink], { stdio: 'ignore' });
    if (code === 0) {
      return;
    }
  } else {
    const code = await run('xdg-open', [deepLink], { stdio: 'ignore' });
    if (code === 0) {
      return;
    }
  }

  process.stdout.write(
    '\nCould not launch Responsively automatically.\n' +
      'Open ResponsivelyApp manually, then load:\n' +
      '  ' +
      url +
      '\n',
  );
}

async function runSlice(url) {
  return run(process.execPath, [cliPath, url, '--widths', widths, '--wait', '0', '--out', outDir], {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
  });
}

await rm(outDir, { recursive: true, force: true });

const { server, baseUrl, requestedPort, usedFallbackPort } = await startPreferredDemoServer(4173);
const brokenUrl = baseUrl + '/broken.html';
const fixedUrl = baseUrl + '/fixed.html';

try {
  if (usedFallbackPort) {
    process.stdout.write(
      `\nPort ${requestedPort} is already in use. Using ${new URL(baseUrl).port} instead.\n`,
    );
  }

  process.stdout.write(
    '\n========================================\n' +
      ' Viewportable Engine + Responsively visual demo\n' +
      '========================================\n\n' +
      'Both tools will inspect the same page:\n' +
      '  ' +
      brokenUrl +
      '\n\n' +
      'Responsively = visual evidence across device previews\n' +
      'Viewportable Engine         = deterministic selector, overflow px and exact boundary\n',
  );

  if (shouldOpenResponsively) {
    process.stdout.write('\nOpening the broken page in Responsively...\n');
    await openResponsively(brokenUrl);
  }

  process.stdout.write('\nScanning the same URL with Viewportable Engine...\n');
  const exitCode = await runSlice(brokenUrl);

  if (exitCode !== 1) {
    throw new Error('The intentionally broken demo page was expected to exit with code 1');
  }

  const report = JSON.parse(await readFile(path.join(outDir, 'results.json'), 'utf8'));
  const rootCause = report.rootCauses.find((candidate) => candidate.selector.includes('plan-grid'));

  if (!rootCause || report.rootCauses.length !== 1) {
    throw new Error('Expected exactly one grouped pricing-grid root cause');
  }

  const diagnosis = rootCause.diagnosis;
  if (
    !diagnosis ||
    diagnosis.kind !== 'min-width-constraint' ||
    diagnosis.value !== '720px' ||
    diagnosis.source?.selector !== '.broken .plan-grid' ||
    !diagnosis.source.stylesheet?.endsWith('/styles.css')
  ) {
    throw new Error('Expected min-width: 720px diagnosis sourced from .broken .plan-grid');
  }

  const observation390 = rootCause.observations.find(
    (observation) => observation.viewportWidth === 390,
  );
  if (
    !observation390 ||
    observation390.computedWidthPx !== 720 ||
    observation390.availableWidthPx !== 372
  ) {
    throw new Error('Expected 720px grid width vs 372px available at 390px');
  }

  const rootBoundary = rootCause.boundaries[0]?.boundary;
  if (rootBoundary !== 742) {
    throw new Error(`Expected pricing-grid boundary 742px, got ${rootBoundary ?? 'none'}`);
  }

  const boundaryViewports = [742, 743, 744].map((width) => {
    const viewport = report.viewports.find((candidate) => candidate.width === width);
    if (!viewport) {
      throw new Error(`Missing golden boundary viewport ${width}px`);
    }
    return viewport;
  });

  const boundaryStatuses = boundaryViewports.map((viewport) => viewport.status);
  if (boundaryStatuses.join(',') !== 'fail,pass,pass') {
    throw new Error(
      `Expected 742 FAIL / 743 PASS / 744 PASS, got ${boundaryViewports
        .map((viewport) => `${viewport.width} ${viewport.status.toUpperCase()}`)
        .join(' / ')}`,
    );
  }

  process.stdout.write(
    '\nVisual correlation\n' +
      '  Same URL:     ' +
      brokenUrl +
      '\n' +
      '  Failing at:   ' +
      report.viewports
        .filter((viewport) => viewport.status === 'fail')
        .map((viewport) => viewport.width + 'px')
        .join(', ') +
      '\n' +
      '  Passing at:   ' +
      report.viewports
        .filter((viewport) => viewport.status === 'pass')
        .map((viewport) => viewport.width + 'px')
        .join(', ') +
      '\n' +
      '  Root cause:   ' +
      rootCause.selector +
      '\n' +
      '  Reason:       ' +
      diagnosis.property +
      ': ' +
      diagnosis.value +
      '\n' +
      '  At 390px:     ' +
      observation390.computedWidthPx +
      'px wide vs ' +
      observation390.availableWidthPx +
      'px available\n' +
      '  Source:       ' +
      diagnosis.source.selector +
      ' @ styles.css\n' +
      '  Evidence:     ' +
      rootCause.issueIds.length +
      ' leaf selectors\n' +
      '  Boundary:     ' +
      rootBoundary +
      'px\n' +
      '  Near boundary:' +
      '\n' +
      boundaryViewports
        .map((viewport) => '    ' + viewport.width + 'px  ' + viewport.status.toUpperCase())
        .join('\n') +
      '\n' +
      '  Viewportable Engine report: .slice/demo-responsively/results.json\n\n' +
      'For visual boundary verification in Responsively, import:\n' +
      '  examples/responsively/slice-boundary-suite.json\n' +
      'and activate the "Viewportable Engine Boundary 742-744" preview suite.\n\n' +
      'Fixed comparison:\n' +
      '  ' +
      fixedUrl +
      '\n',
  );

  if (shouldExitAfterScan) {
    await closeDemoServer(server);
  } else {
    process.stdout.write(
      '\nThe demo server stays alive so Responsively can keep rendering it.\n' +
        'Press Ctrl-C when finished.\n',
    );

    await new Promise((resolve) => {
      const stop = async () => {
        process.removeListener('SIGINT', stop);
        process.removeListener('SIGTERM', stop);
        await closeDemoServer(server);
        resolve();
      };

      process.on('SIGINT', stop);
      process.on('SIGTERM', stop);
    });
  }
} catch (error) {
  await closeDemoServer(server);
  throw error;
}
