import { spawn } from 'node:child_process';
import { access, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const brokenRef = process.env.OPENINGS_BROKEN_REF ?? '27bc8c0d6f4ee95f98c8638a2648b5bc278e18e2';
const fixedBaselineRef =
  process.env.OPENINGS_FIXED_BASELINE_REF ?? 'ba0d9445feca93ec3c533b644b2e5ae709af04bc';
const widths =
  process.env.OPENINGS_GOLDEN_WIDTHS ?? '320,375,390,430,767,768,819,820,1024,1280,1440';
const harnessPort = process.env.OPENINGS_GOLDEN_PORT ?? '4179';
const goldenRoot = path.join(root, '.slice', 'golden', 'openings');

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, options);
    child.once('error', reject);
    child.once('close', (code) => resolve(code ?? 1));
  });
}

async function runChecked(command, args, options = {}, accepted = [0]) {
  const code = await run(command, args, options);
  if (!accepted.includes(code)) {
    throw new Error(
      `${command} ${args.join(' ')} exited with ${code}; expected ${accepted.join(' or ')}`,
    );
  }
  return code;
}

async function capture(command, args, cwd) {
  let stdout = '';
  let stderr = '';

  const code = await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: process.env });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', reject);
    child.once('close', (result) => resolve(result ?? 1));
  });

  if (code !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed in ${cwd}: ${stderr.trim() || stdout.trim()}`,
    );
  }

  return stdout.trim();
}

async function isOpeningsRepo(candidate) {
  try {
    await access(path.join(candidate, 'package.json'));
    const topLevel = await capture('git', ['rev-parse', '--show-toplevel'], candidate);
    return path.resolve(topLevel) === path.resolve(candidate);
  } catch {
    return false;
  }
}

async function resolveOpeningsRepo() {
  if (process.env.OPENINGS_REPO) {
    const explicit = path.resolve(process.env.OPENINGS_REPO);
    if (await isOpeningsRepo(explicit)) return explicit;
    throw new Error(`OPENINGS_REPO is not a Git checkout: ${explicit}`);
  }

  const candidates = [
    path.resolve(root, '../openings'),
    path.resolve(root, '../../sergii/openings'),
    path.join(os.homedir(), 'repos', 'sergii', 'openings'),
  ];

  for (const candidate of candidates) {
    if (await isOpeningsRepo(candidate)) return candidate;
  }

  throw new Error('Openings repo not found. Set OPENINGS_REPO=/absolute/path/to/sergii/openings.');
}

async function readReport(reportPath) {
  return JSON.parse(await readFile(reportPath, 'utf8'));
}

function issuesAt(report, width, type) {
  const viewport = report.viewports.find((candidate) => candidate.width === width);
  if (!viewport) throw new Error(`Golden report is missing viewport ${width}px`);
  return viewport.issues.filter((issue) => issue.type === type);
}

function assertBrokenGolden(report) {
  const at767 = issuesAt(report, 767, 'fixed-content-occlusion');
  const at768 = issuesAt(report, 768, 'fixed-content-occlusion');
  const at819 = issuesAt(report, 819, 'fixed-content-occlusion');
  const at820 = issuesAt(report, 820, 'fixed-content-occlusion');

  if (at767.length !== 0) {
    throw new Error('Historical broken Openings unexpectedly occludes content at 767px.');
  }
  if (at768.length === 0) {
    throw new Error('Historical broken Openings no longer reproduces the known 768px occlusion.');
  }
  if (at819.length === 0) {
    throw new Error('Historical broken Openings no longer reproduces the mismatch through 819px.');
  }
  if (at820.length !== 0) {
    throw new Error('Historical broken Openings unexpectedly keeps the occlusion at 820px.');
  }

  const issueAt819 = new Set(at819.map((issue) => issue.id));
  const stableIssue = at768.find((issue) => issueAt819.has(issue.id));

  if (!stableIssue) {
    throw new Error('No stable fixed-content-occlusion issue spans 768px through 819px.');
  }

  const boundaries = report.boundaries
    .filter((boundary) => boundary.issueId === stableIssue.id)
    .map((boundary) => boundary.boundary)
    .sort((a, b) => a - b);

  if (!boundaries.includes(768) || !boundaries.includes(819)) {
    throw new Error(
      `Expected issue ${stableIssue.id} boundaries at 768px and 819px; got ${boundaries.join(', ') || 'none'}.`,
    );
  }

  return {
    issueId: stableIssue.id,
    selector: stableIssue.selector,
    targetSelector: stableIssue.targetSelector,
    boundaries,
  };
}

function assertFixedGolden(report) {
  const failing = report.viewports.filter((viewport) => viewport.status === 'fail');

  if (failing.length > 0 || report.summary.totalIssues !== 0) {
    const widthsText = failing.map((viewport) => viewport.width).join(', ');
    throw new Error(
      `Current Openings is not clean: ${report.summary.totalIssues} issues at ${widthsText || 'unknown widths'}.`,
    );
  }

  if (report.boundaries.length !== 0 || report.rootCauses.length !== 0) {
    throw new Error(
      'Current Openings is clean by viewport status but still reports active boundaries/root causes.',
    );
  }
}

function normalizeForDeterminism(report) {
  const normalized = structuredClone(report);
  delete normalized.timestamp;
  delete normalized.summary.durationMs;
  return normalized;
}

function assertDeterministic(first, second) {
  const firstNormalized = JSON.stringify(normalizeForDeterminism(first));
  const secondNormalized = JSON.stringify(normalizeForDeterminism(second));

  if (firstNormalized !== secondNormalized) {
    throw new Error(
      'Consecutive Openings reports differ after removing only timestamp and summary.durationMs.',
    );
  }
}

async function ensureCommit(repo, ref) {
  const probe = await run('git', ['cat-file', '-e', `${ref}^{commit}`], {
    cwd: repo,
    stdio: 'ignore',
    env: process.env,
  });

  if (probe === 0) return;

  await runChecked('git', ['fetch', 'origin', ref], {
    cwd: repo,
    stdio: 'inherit',
    env: process.env,
  });
}

async function runOpeningsTrial(openingsRepo, outDir) {
  return run('npm', ['run', 'test:slice'], {
    cwd: openingsRepo,
    stdio: 'inherit',
    env: {
      ...process.env,
      SLICE_REPO: root,
      SLICE_WIDTHS: widths,
      SLICE_HARNESS_PORT: harnessPort,
      SLICE_OUT_DIR: outDir,
      SLICE_SKIP_SLICE_BUILD: '1',
    },
  });
}

const openingsRepo = await resolveOpeningsRepo();
const fixedHead = await capture('git', ['rev-parse', 'HEAD'], openingsRepo);
const dirty = await capture('git', ['status', '--porcelain'], openingsRepo);

if (dirty && process.env.OPENINGS_ALLOW_DIRTY !== '1') {
  throw new Error(
    'Openings working tree is dirty. Commit/stash changes or set OPENINGS_ALLOW_DIRTY=1 deliberately.',
  );
}

const fixedBaselineCheck = await run(
  'git',
  ['merge-base', '--is-ancestor', fixedBaselineRef, fixedHead],
  {
    cwd: openingsRepo,
    stdio: 'ignore',
    env: process.env,
  },
);

if (fixedBaselineCheck !== 0) {
  throw new Error(
    `Current Openings HEAD ${fixedHead} does not include the known breakpoint fix ${fixedBaselineRef}.`,
  );
}

await ensureCommit(openingsRepo, brokenRef);
await mkdir(goldenRoot, { recursive: true });

process.stdout.write(
  `\nSlice Golden Acceptance · Openings\n\n` +
    `  Engine:          ${root}\n` +
    `  Openings:        ${openingsRepo}\n` +
    `  Broken ref:      ${brokenRef}\n` +
    `  Fixed HEAD:      ${fixedHead}\n` +
    `  Widths:          ${widths}\n` +
    `  Stable port:     ${harnessPort}\n\n`,
);

await runChecked('npm', ['run', 'build', '--silent'], {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
});

const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'slice-openings-golden-'));
const brokenWorktree = path.join(tempRoot, 'broken');
let worktreeAdded = false;

try {
  process.stdout.write('\n[1/4] Historical broken Openings\n');
  await runChecked('git', ['worktree', 'add', '--detach', brokenWorktree, brokenRef], {
    cwd: openingsRepo,
    stdio: 'inherit',
    env: process.env,
  });
  worktreeAdded = true;

  await runChecked('npm', ['ci', '--ignore-scripts'], {
    cwd: brokenWorktree,
    stdio: 'inherit',
    env: process.env,
  });

  const brokenCode = await run('npm', ['run', 'test:slice'], {
    cwd: brokenWorktree,
    stdio: 'inherit',
    env: {
      ...process.env,
      SLICE_REPO: root,
      SLICE_WIDTHS: widths,
    },
  });

  if (brokenCode !== 1) {
    throw new Error(
      `Historical broken Openings returned Engine CLI exit code ${brokenCode}; expected findings exit code 1.`,
    );
  }

  const brokenSource = path.join(brokenWorktree, '.slice', 'openings', 'results.json');
  const brokenOut = path.join(goldenRoot, 'broken');
  await mkdir(brokenOut, { recursive: true });
  await copyFile(brokenSource, path.join(brokenOut, 'results.json'));
  const brokenReport = await readReport(brokenSource);
  const brokenGolden = assertBrokenGolden(brokenReport);

  process.stdout.write(
    `  PASS historical regression reproduced: ${brokenGolden.issueId} active 768-819px\n`,
  );

  process.stdout.write('\n[2/4] Current Openings fixed run #1\n');
  await runChecked('npm', ['ci', '--ignore-scripts'], {
    cwd: openingsRepo,
    stdio: 'inherit',
    env: process.env,
  });

  const fixedOneDir = path.join(goldenRoot, 'fixed-1');
  const fixedOneCode = await runOpeningsTrial(openingsRepo, fixedOneDir);
  if (fixedOneCode !== 0) {
    throw new Error(
      `Current Openings fixed run #1 returned exit code ${fixedOneCode}; expected 0.`,
    );
  }
  const fixedOne = await readReport(path.join(fixedOneDir, 'results.json'));
  assertFixedGolden(fixedOne);

  process.stdout.write('\n[3/4] Current Openings fixed run #2\n');
  const fixedTwoDir = path.join(goldenRoot, 'fixed-2');
  const fixedTwoCode = await runOpeningsTrial(openingsRepo, fixedTwoDir);
  if (fixedTwoCode !== 0) {
    throw new Error(
      `Current Openings fixed run #2 returned exit code ${fixedTwoCode}; expected 0.`,
    );
  }
  const fixedTwo = await readReport(path.join(fixedTwoDir, 'results.json'));
  assertFixedGolden(fixedTwo);

  process.stdout.write('\n[4/4] Determinism\n');
  assertDeterministic(fixedOne, fixedTwo);

  const summary = {
    version: 1,
    slicePackage: '@viewportable/slice',
    openings: {
      repository: 'sergii/openings',
      brokenRef,
      fixedBaselineRef,
      fixedHead,
    },
    widths: widths.split(',').map((value) => Number.parseInt(value, 10)),
    broken: {
      expectedExitCode: 1,
      issueType: 'fixed-content-occlusion',
      issueId: brokenGolden.issueId,
      selector: brokenGolden.selector,
      targetSelector: brokenGolden.targetSelector,
      activeRange: {
        firstBadWidth: 768,
        lastBadWidth: 819,
      },
      boundaries: brokenGolden.boundaries,
      report: '.slice/golden/openings/broken/results.json',
    },
    fixed: {
      expectedExitCode: 0,
      clean: true,
      consecutiveRunsDeterministic: true,
      ignoredForComparison: ['timestamp', 'summary.durationMs'],
      reports: [
        '.slice/golden/openings/fixed-1/results.json',
        '.slice/golden/openings/fixed-2/results.json',
      ],
    },
  };

  await writeFile(
    path.join(goldenRoot, 'summary.json'),
    `${JSON.stringify(summary, null, 2)}\n`,
    'utf8',
  );

  process.stdout.write(
    '\nGOLDEN PASS\n' +
      '  broken: real historical 768-819px occlusion reproduced with exact boundaries\n' +
      '  fixed: current Openings clean across the golden width matrix\n' +
      '  deterministic: fixed reports identical except timestamp and durationMs\n' +
      '  summary: .slice/golden/openings/summary.json\n\n',
  );
} finally {
  if (worktreeAdded) {
    await run('git', ['worktree', 'remove', '--force', brokenWorktree], {
      cwd: openingsRepo,
      stdio: 'ignore',
      env: process.env,
    });
  }
  await rm(tempRoot, { recursive: true, force: true });
}
