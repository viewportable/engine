import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { access, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CLASS_MAPPING,
  STANDARD_WIDTHS,
  classifyAntiOracleReport,
  classifyFailure,
  parseAntiOracle,
  parseOracle,
  widthsForPage,
} from './lib/redecheck-oracle.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cacheRoot = path.join(repoRoot, '.cache', 'redecheck');
const pagesDir = path.join(cacheRoot, 'pages');
const archivePath = path.join(cacheRoot, 'results-archive.md');
const sourcesPath = path.join(repoRoot, 'benchmark', 'redecheck', 'sources.json');
const reviewPath = path.join(repoRoot, 'benchmark', 'redecheck', 'review.json');
const outputRoot = path.join(repoRoot, '.slice', 'benchmarks', 'redecheck');
const pageOutputRoot = path.join(outputRoot, 'pages');
const cliPath = path.join(repoRoot, 'dist', 'cli.mjs');

const VIEWPORT_HEIGHT = 900;
const WAIT_MS = 100;
const TIMEOUT_MS = 15_000;

function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...options,
      stdio: ['ignore', 'pipe', 'pipe'],
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
    child.once('error', reject);
    child.once('close', (status, signal) => {
      resolve({ status, signal, stdout, stderr });
    });
  });
}

function slug(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function mimeType(filePath) {
  const extension = path.extname(filePath).toLowerCase();

  return (
    {
      '.css': 'text/css; charset=utf-8',
      '.gif': 'image/gif',
      '.htm': 'text/html; charset=utf-8',
      '.html': 'text/html; charset=utf-8',
      '.ico': 'image/x-icon',
      '.jpeg': 'image/jpeg',
      '.jpg': 'image/jpeg',
      '.js': 'text/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.png': 'image/png',
      '.svg': 'image/svg+xml',
      '.woff': 'font/woff',
      '.woff2': 'font/woff2',
    }[extension] ?? 'application/octet-stream'
  );
}

async function resolveRequestFile(requestUrl) {
  const pathname = decodeURIComponent(new URL(requestUrl, 'http://localhost').pathname);
  const root = path.resolve(pagesDir);
  let filePath = path.resolve(root, `.${pathname}`);

  if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) {
    return null;
  }

  try {
    const fileStat = await stat(filePath);
    if (fileStat.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
    }
    await access(filePath);
    return filePath;
  } catch {
    return null;
  }
}

async function startServer() {
  const server = http.createServer(async (request, response) => {
    const filePath = await resolveRequestFile(request.url ?? '/');

    if (!filePath) {
      response.writeHead(404);
      response.end('Not found');
      return;
    }

    response.writeHead(200, {
      'content-type': mimeType(filePath),
      'cache-control': 'no-store',
      'content-security-policy':
        "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline' data:; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'none'; frame-src 'self' data:;",
    });
    createReadStream(filePath).pipe(response);
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('Benchmark server did not expose a TCP port');
  }

  return {
    server,
    origin: `http://127.0.0.1:${address.port}`,
  };
}

async function corpusPages() {
  const entries = await readdir(pagesDir, { withFileTypes: true });
  const pages = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const indexPath = path.join(pagesDir, entry.name, 'index.html');
    try {
      await access(indexPath);
      pages.push(entry.name);
    } catch {
      // Special corpus directories such as MHTML Files are intentionally skipped.
    }
  }

  pages.sort((a, b) => a.localeCompare(b));

  if (pages.length !== 26) {
    throw new Error(`Expected 26 ReDeCheck corpus pages, found ${pages.length}`);
  }

  return pages;
}

function renderSummary(report) {
  const lines = [
    '# ReDeCheck Baseline',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    '## Summary',
    '',
    `- Oracle distinct RLFs: **${report.summary.oracleFailures}**`,
    `- Candidate matches: **${report.summary.candidateMatches}**`,
    `- Reviewed confirmed detections: **${report.summary.confirmedDetections}**`,
    `- Reviewed incidental candidates: **${report.summary.rejectedIncidental}**`,
    `- Unreviewed candidate matches: **${report.summary.unreviewedCandidates}**`,
    `- Missed within currently compatible rule families: **${report.summary.missed}**`,
    `- Unsupported by current detector families: **${report.summary.unsupported}**`,
    `- Environment errors: **${report.summary.environmentErrors}**`,
    `- Anti-oracle raw reports (FP + NOI): **${report.summary.antiOracleReports}**`,
    `- Anti-oracle negative candidates: **${report.summary.negativeCandidates}**`,
    `- Anti-oracle clean comparable reports: **${report.summary.antiOracleClean}**`,
    `- Corpus pages scanned: **${report.summary.pagesScanned}/${report.summary.corpusPages}**`,
    `- Sampled viewport renders: **${report.summary.viewportsChecked}**`,
    `- Raw Slice issues emitted: **${report.summary.rawIssues}**`,
    `- Aggregate Slice scan time: **${(report.summary.sliceDurationMs / 1000).toFixed(1)}s**`,
    '',
    '> Candidate match means compatible rule family + same page + sampled width inside the oracle range. It still requires evidence/identity review before being called a confirmed detection.',
    '',
    '## By support level',
    '',
    '| Support | Distinct RLFs | Candidate | Missed | Environment |',
    '| --- | ---: | ---: | ---: | ---: |',
  ];

  for (const entry of report.bySupport) {
    lines.push(
      `| ${entry.support} | ${entry.total} | ${entry.candidateMatch} | ${entry.missed} | ${entry.environmentError} |`,
    );
  }

  lines.push(
    '',
    '## Oracle report classes',
    '',
    '| ReDeCheck report class | Distinct RLFs carrying class | Current Slice mapping | Support |',
    '| --- | ---: | --- | --- |',
  );

  for (const entry of report.byReportType) {
    lines.push(
      `| ${entry.type} | ${entry.distinctFailures} | ${entry.issueTypes.join(', ') || 'none'} | ${entry.support} |`,
    );
  }

  lines.push(
    '',
    '> One Distinct RLF can carry more than one ReDeCheck report class. For example, a narrow collision can also be reported as Small-Range. Therefore report-class counts do not sum to 33.',
    '',
    '## Anti-oracle',
    '',
    'ReDeCheck also classified raw reports as false positives (FP) or non-observable issues (NOI). A negative candidate means Slice emitted a compatible rule in the same page/range; it is a review candidate, not an automatically proven false positive.',
    '',
    '| Source classification | Raw reports | Negative candidate | Clean | Unsupported | Environment |',
    '| --- | ---: | ---: | ---: | ---: | ---: |',
  );

  for (const entry of report.antiOracleBySource) {
    lines.push(
      `| ${entry.sourceClassification} | ${entry.total} | ${entry.negativeCandidate} | ${entry.clean} | ${entry.unsupported} | ${entry.environmentError} |`,
    );
  }

  lines.push(
    '',
    '## Distinct RLFs',
    '',
    '| ID | Page | Oracle report(s) | Support | Baseline | Review | Candidate evidence |',
    '| ---: | --- | --- | --- | --- | --- | --- |',
  );

  for (const failure of report.failures) {
    const uniqueReports = [
      ...new Map(
        failure.reports.map((report) => [
          `${report.type}|${report.range.min}|${report.range.max}`,
          report,
        ]),
      ).values(),
    ];
    const rawReportSuffix =
      failure.reports.length > uniqueReports.length
        ? ` (${failure.reports.length} raw reports)`
        : '';
    const oracleReports =
      uniqueReports
        .map((report) => `${report.type} ${report.range.min}-${report.range.max}px`)
        .join('<br>') + rawReportSuffix;
    const evidence =
      failure.matches.length === 0
        ? ''
        : failure.matches
            .slice(0, 3)
            .map((match) => {
              const oracleTypes = match.oracleReportTypes.join('/');
              const side = match.side ? ` side=${match.side}` : '';
              return `${match.issueType}@${match.viewportWidth}px [${oracleTypes}]${side} ${match.selector ?? ''}`.trim();
            })
            .join('<br>');

    const reviewStatus = failure.classification === 'candidate-match' ? failure.review.status : '';

    lines.push(
      `| ${failure.id} | ${failure.page} | ${oracleReports} | ${failure.support} | **${failure.classification}** | ${reviewStatus} | ${evidence} |`,
    );
  }

  lines.push(
    '',
    '## Interpretation',
    '',
    '- `unsupported` identifies real capability gaps and is not counted as a miss.',
    '- `missed` means the current engine has a nominally compatible rule family but found no compatible issue at sampled widths inside the known failure range.',
    '- `candidate-match` is deliberately weaker than confirmed detection until subject identity/evidence is reviewed.',
    '- Reviewed candidates are marked `confirmed` or `rejected-incidental` in `benchmark/redecheck/review.json`.',
    '- `negative-candidate` is similarly a review queue, not an automatic false-positive verdict.',
    '- page-level raw results are preserved under `pages/` for follow-up review.',
    '',
  );

  const environmentPages = Object.entries(report.environmentPages);

  if (environmentPages.length > 0) {
    lines.push('## Environment errors', '', '| Page | Exit | Error |', '| --- | ---: | --- |');

    for (const [page, pageRun] of environmentPages) {
      const error = (pageRun.stderr || pageRun.stdout || 'unknown scanner error')
        .replace(/\s+/g, ' ')
        .slice(0, 240);
      lines.push(`| ${page} | ${pageRun.exitCode ?? ''} | ${error} |`);
    }

    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}

await access(cliPath);
await access(archivePath);

const sources = JSON.parse(await readFile(sourcesPath, 'utf8'));
const review = JSON.parse(await readFile(reviewPath, 'utf8'));
const reviewById = new Map(review.reviews.map((entry) => [entry.id, entry]));
const archive = await readFile(archivePath, 'utf8');
const oracleFailures = parseOracle(archive);
const antiOracleReports = parseAntiOracle(archive);
const corpus = await corpusPages();
const failuresByPage = new Map();
const antiReportsByPage = new Map();

for (const failure of oracleFailures) {
  const list = failuresByPage.get(failure.page) ?? [];
  list.push(failure);
  failuresByPage.set(failure.page, list);
}

for (const report of antiOracleReports) {
  const list = antiReportsByPage.get(report.page) ?? [];
  list.push(report);
  antiReportsByPage.set(report.page, list);
}

await mkdir(pageOutputRoot, { recursive: true });

const { server, origin } = await startServer();
const pageRuns = new Map();

try {
  for (const corpusPage of corpus) {
    const oraclePage =
      [...failuresByPage.keys()].find((name) => name.toLowerCase() === corpusPage.toLowerCase()) ??
      corpusPage;
    const pageFailures = failuresByPage.get(oraclePage) ?? [];
    const pageAntiReports = antiReportsByPage.get(oraclePage) ?? [];
    const widths = widthsForPage(pageFailures, pageAntiReports);
    const pageOut = path.join(pageOutputRoot, slug(corpusPage));
    const url = `${origin}/${encodeURIComponent(corpusPage)}/index.html`;

    process.stdout.write(
      `Scanning ${corpusPage} at ${widths.length} widths (${widths.join(',')})\n`,
    );

    const child = await runProcess(
      process.execPath,
      [
        cliPath,
        url,
        '--widths',
        widths.join(','),
        '--height',
        String(VIEWPORT_HEIGHT),
        '--out',
        pageOut,
        '--no-boundary',
        '--wait',
        String(WAIT_MS),
        '--timeout',
        String(TIMEOUT_MS),
      ],
      {
        cwd: repoRoot,
      },
    );

    const resultPath = path.join(pageOut, 'results.json');

    if (![0, 1].includes(child.status ?? 2)) {
      pageRuns.set(oraclePage, {
        status: 'environment-error',
        corpusPage,
        widths,
        exitCode: child.status,
        stderr: child.stderr?.trim() ?? '',
        stdout: child.stdout?.trim() ?? '',
      });
      continue;
    }

    try {
      const result = JSON.parse(await readFile(resultPath, 'utf8'));
      pageRuns.set(oraclePage, {
        status: 'ok',
        corpusPage,
        widths,
        exitCode: child.status,
        result,
      });
    } catch (error) {
      pageRuns.set(oraclePage, {
        status: 'environment-error',
        corpusPage,
        widths,
        exitCode: child.status,
        stderr: `Could not read Slice results: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
    }
  }
} finally {
  await new Promise((resolve) => server.close(resolve));
}

const scoredFailures = oracleFailures.map((failure) => {
  const automatic = classifyFailure(failure, pageRuns.get(failure.page));
  const reviewed = reviewById.get(failure.id);

  let reviewedStatus = 'unreviewed';
  if (automatic.classification === 'candidate-match' && reviewed) {
    reviewedStatus = reviewed.status;
  }

  return {
    ...failure,
    ...automatic,
    review: reviewed
      ? {
          status: reviewedStatus,
          reason: reviewed.reason,
        }
      : {
          status: reviewedStatus,
          reason: null,
        },
  };
});

const scoredAntiOracle = antiOracleReports.map((antiReport) => ({
  ...antiReport,
  sourceClassification: antiReport.classification,
  ...classifyAntiOracleReport(antiReport, pageRuns.get(antiReport.page)),
}));

const classifications = {
  'candidate-match': 0,
  missed: 0,
  unsupported: 0,
  'environment-error': 0,
};

for (const failure of scoredFailures) {
  classifications[failure.classification] += 1;
}

const bySupport = ['compatible', 'partial', 'unsupported'].map((support) => {
  const failures = scoredFailures.filter((failure) => failure.support === support);

  return {
    support,
    total: failures.length,
    candidateMatch: failures.filter((failure) => failure.classification === 'candidate-match')
      .length,
    missed: failures.filter((failure) => failure.classification === 'missed').length,
    environmentError: failures.filter((failure) => failure.classification === 'environment-error')
      .length,
  };
});

const byReportType = Object.entries(CLASS_MAPPING).map(([type, mapping]) => ({
  type,
  distinctFailures: oracleFailures.filter((failure) => failure.reportTypes.includes(type)).length,
  support: mapping.support,
  issueTypes: mapping.issueTypes,
}));

const antiOracleBySource = ['FP', 'NOI'].map((sourceClassification) => {
  const reports = scoredAntiOracle.filter(
    (report) => report.sourceClassification === sourceClassification,
  );

  return {
    sourceClassification,
    total: reports.length,
    negativeCandidate: reports.filter((report) => report.classification === 'negative-candidate')
      .length,
    clean: reports.filter((report) => report.classification === 'clean').length,
    unsupported: reports.filter((report) => report.classification === 'unsupported').length,
    environmentError: reports.filter((report) => report.classification === 'environment-error')
      .length,
  };
});

const successfulRuns = [...pageRuns.values()].filter((run) => run.status === 'ok');
const report = {
  version: 1,
  generatedAt: new Date().toISOString(),
  sources,
  methodology: {
    oracle: 'ReDeCheck manually classified distinct true-positive RLFs',
    standardWidths: STANDARD_WIDTHS,
    sampledFromOracle: ['min', 'midpoint', 'max'],
    boundarySearch: false,
    viewportHeight: VIEWPORT_HEIGHT,
    waitMs: WAIT_MS,
    timeoutMs: TIMEOUT_MS,
    automaticClassification: 'candidate-match only; confirmation requires evidence review',
  },
  summary: {
    oracleFailures: oracleFailures.length,
    candidateMatches: classifications['candidate-match'],
    confirmedDetections: scoredFailures.filter(
      (failure) =>
        failure.classification === 'candidate-match' && failure.review.status === 'confirmed',
    ).length,
    rejectedIncidental: scoredFailures.filter(
      (failure) =>
        failure.classification === 'candidate-match' &&
        failure.review.status === 'rejected-incidental',
    ).length,
    unreviewedCandidates: scoredFailures.filter(
      (failure) =>
        failure.classification === 'candidate-match' && failure.review.status === 'unreviewed',
    ).length,
    missed: classifications.missed,
    unsupported: classifications.unsupported,
    environmentErrors: classifications['environment-error'],
    antiOracleReports: scoredAntiOracle.length,
    negativeCandidates: scoredAntiOracle.filter(
      (report) => report.classification === 'negative-candidate',
    ).length,
    antiOracleClean: scoredAntiOracle.filter((report) => report.classification === 'clean').length,
    antiOracleUnsupported: scoredAntiOracle.filter(
      (report) => report.classification === 'unsupported',
    ).length,
    antiOracleEnvironmentErrors: scoredAntiOracle.filter(
      (report) => report.classification === 'environment-error',
    ).length,
    corpusPages: corpus.length,
    pagesScanned: successfulRuns.length,
    viewportsChecked: successfulRuns.reduce(
      (sum, run) => sum + (run.result.summary?.viewportsChecked ?? 0),
      0,
    ),
    rawIssues: successfulRuns.reduce((sum, run) => sum + (run.result.summary?.totalIssues ?? 0), 0),
    sliceDurationMs: successfulRuns.reduce(
      (sum, run) => sum + (run.result.summary?.durationMs ?? 0),
      0,
    ),
  },
  bySupport,
  byReportType,
  antiOracleBySource,
  failures: scoredFailures,
  antiOracle: scoredAntiOracle,
  environmentPages: Object.fromEntries(
    [...pageRuns].filter(([, pageRun]) => pageRun.status === 'environment-error'),
  ),
  pages: Object.fromEntries(pageRuns),
};

const oracle = {
  version: 1,
  generatedAt: report.generatedAt,
  source: sources.oracle,
  distinctFailures: oracleFailures,
};

await mkdir(outputRoot, { recursive: true });
await writeFile(path.join(outputRoot, 'oracle.json'), `${JSON.stringify(oracle, null, 2)}\n`);
await writeFile(path.join(outputRoot, 'results.json'), `${JSON.stringify(report, null, 2)}\n`);
await writeFile(path.join(outputRoot, 'summary.md'), renderSummary(report));

process.stdout.write(
  [
    '',
    'ReDeCheck baseline complete',
    `  candidate matches: ${report.summary.candidateMatches}`,
    `  missed:            ${report.summary.missed}`,
    `  unsupported:       ${report.summary.unsupported}`,
    `  environment error: ${report.summary.environmentErrors}`,
    `  summary:           ${path.relative(repoRoot, path.join(outputRoot, 'summary.md'))}`,
    '',
  ].join('\n'),
);
