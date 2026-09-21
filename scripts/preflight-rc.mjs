import { spawn } from 'node:child_process';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function run(command, args, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env,
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('close', (code) => resolve(code ?? 1));
  });
}

async function checked(label, command, args, env = process.env) {
  process.stdout.write(`\n==> ${label}\n\n`);
  const code = await run(command, args, env);

  if (code !== 0) {
    throw new Error(`${label} failed with exit code ${code}`);
  }
}

const { stdout: status } = await execFileAsync('git', ['status', '--porcelain']);

if (status.trim() && process.env.SLICE_PREFLIGHT_ALLOW_DIRTY !== '1') {
  throw new Error(
    'Viewportable Engine working tree is dirty. Commit/stash changes or set SLICE_PREFLIGHT_ALLOW_DIRTY=1 deliberately.',
  );
}

process.stdout.write(
  '\n========================================\n' +
    ' Viewportable Engine RC preflight\n' +
    '========================================\n',
);

await checked('Fast deterministic gates', 'npm', ['run', 'check:fast']);

if (process.env.SLICE_PREFLIGHT_SKIP_BROWSER_INSTALL !== '1') {
  await checked('Ensure Playwright Chromium', 'npx', ['playwright', 'install', 'chromium']);
}

await checked('Browser integration tests', 'npm', ['run', 'test:integration']);
await checked('Built CLI smoke', 'npm', ['run', 'smoke']);
await checked('Built-in broken/fixed demo', 'npm', ['run', 'demo']);
await checked('Responsively correlation harness', 'npm', ['run', 'demo:responsively:check']);
await checked('Release layout sanity', 'npm', ['run', 'validate:release']);
await checked('Openings Golden Acceptance', 'npm', ['run', 'golden:openings']);

process.stdout.write(
  '\n========================================\n' +
    ' RC READY\n' +
    '========================================\n\n' +
    'All repository, browser, demo, release-layout, and Openings golden gates passed.\n' +
    'Next: bump to the RC version, pin Action docs to that tag, validate the tag, commit, and tag.\n\n',
);
