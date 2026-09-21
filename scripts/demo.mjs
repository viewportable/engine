import { spawn } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeDemoServer, startDemoServer } from './demo-server.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cliPath = path.join(root, 'dist', 'cli.mjs');
const outRoot = path.join(root, '.slice', 'demo');

function runCli(url, out) {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [cliPath, url, '--widths', '320,390,430,768,1024', '--wait', '0', '--out', out],
      {
        cwd: root,
        env: process.env,
        stdio: 'inherit',
      },
    );

    child.on('close', (code) => resolve(code));
  });
}

async function readReport(out) {
  return JSON.parse(await readFile(path.join(out, 'results.json'), 'utf8'));
}

await rm(outRoot, { recursive: true, force: true });

const { server, baseUrl } = await startDemoServer();

try {
  process.stdout.write(
    '\n========================================\n' +
      ' Viewportable Engine local demo\n' +
      '========================================\n\n' +
      'This is not a test fixture. Viewportable Engine is scanning a small standalone demo site\n' +
      'through its built production CLI.\n\n' +
      '1) Intentionally broken responsive pricing page\n',
  );

  const brokenOut = path.join(outRoot, 'broken');
  const brokenExit = await runCli(baseUrl + '/broken.html', brokenOut);
  const broken = await readReport(brokenOut);

  if (brokenExit !== 1 || broken.summary.failed === 0) {
    throw new Error('Broken demo page was expected to fail responsive QA');
  }

  const rootCause = broken.rootCauses.find((candidate) => candidate.selector.includes('plan-grid'));
  if (!rootCause || broken.rootCauses.length !== 1) {
    throw new Error('Broken demo page should resolve to one pricing-grid root cause');
  }
  if (
    rootCause.diagnosis?.kind !== 'min-width-constraint' ||
    rootCause.diagnosis.value !== '720px' ||
    rootCause.diagnosis.source?.selector !== '.broken .plan-grid'
  ) {
    throw new Error('Broken demo page should identify the min-width CSS source');
  }

  process.stdout.write('\n2) The same page after the responsive CSS fix\n');

  const fixedOut = path.join(outRoot, 'fixed');
  const fixedExit = await runCli(baseUrl + '/fixed.html', fixedOut);
  const fixed = await readReport(fixedOut);

  if (fixedExit !== 0 || fixed.summary.failed !== 0 || fixed.rootCauses.length !== 0) {
    throw new Error('Fixed demo page was expected to pass responsive QA');
  }

  process.stdout.write(
    '\n========================================\n' +
      ' Viewportable Engine demo PASS\n' +
      '========================================\n\n' +
      'Reports:\n' +
      '  .slice/demo/broken/results.json\n' +
      '  .slice/demo/fixed/results.json\n\n' +
      'To inspect the site yourself:\n' +
      '  npm run demo:serve\n\n' +
      'Then open:\n' +
      '  http://127.0.0.1:4173/broken.html\n' +
      '  http://127.0.0.1:4173/fixed.html\n\n' +
      'From a second terminal:\n' +
      '  npm run demo:scan\n',
  );
} finally {
  await closeDemoServer(server);
}
