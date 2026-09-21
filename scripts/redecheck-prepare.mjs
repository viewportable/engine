import { execFileSync } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcesPath = path.join(repoRoot, 'benchmark', 'redecheck', 'sources.json');
const cacheRoot = path.join(repoRoot, '.cache', 'redecheck');
const pagesDir = path.join(cacheRoot, 'pages');
const oracleArchivePath = path.join(cacheRoot, 'results-archive.md');
const provenancePath = path.join(cacheRoot, 'provenance.json');

const sources = JSON.parse(await readFile(sourcesPath, 'utf8'));

function git(args, cwd = repoRoot) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

async function ensureCorpus() {
  let currentCommit = null;

  try {
    currentCommit = git(['rev-parse', 'HEAD'], pagesDir);
  } catch {
    currentCommit = null;
  }

  if (currentCommit === sources.corpus.commit) {
    process.stdout.write(`ReDeCheck corpus already pinned at ${currentCommit}\n`);
    return;
  }

  await rm(pagesDir, { recursive: true, force: true });
  await mkdir(pagesDir, { recursive: true });

  git(['init'], pagesDir);
  git(['remote', 'add', 'origin', sources.corpus.url], pagesDir);
  git(['fetch', '--depth=1', 'origin', sources.corpus.commit], pagesDir);
  git(['checkout', '--detach', 'FETCH_HEAD'], pagesDir);

  const checkedOut = git(['rev-parse', 'HEAD'], pagesDir);
  if (checkedOut !== sources.corpus.commit) {
    throw new Error(`Expected corpus commit ${sources.corpus.commit}, checked out ${checkedOut}`);
  }

  process.stdout.write(`Prepared ReDeCheck corpus at ${checkedOut}\n`);
}

async function ensureOracleArchive() {
  const response = await fetch(sources.oracle.rawUrl, {
    headers: {
      'user-agent': 'viewportable-redecheck-benchmark',
    },
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch ReDeCheck oracle archive: ${response.status} ${response.statusText}`,
    );
  }

  const content = await response.text();
  if (!content.includes('### True Positives')) {
    throw new Error('ReDeCheck results archive does not contain the expected TP section');
  }

  await writeFile(oracleArchivePath, content, 'utf8');
  process.stdout.write(
    `Prepared ReDeCheck oracle from ${sources.oracle.repository}@${sources.oracle.commit}\n`,
  );
}

await mkdir(cacheRoot, { recursive: true });
await ensureCorpus();
await ensureOracleArchive();

await writeFile(
  provenancePath,
  `${JSON.stringify(
    {
      preparedAt: new Date().toISOString(),
      corpus: sources.corpus,
      oracle: sources.oracle,
      referenceImplementation: sources.referenceImplementation,
    },
    null,
    2,
  )}\n`,
  'utf8',
);

process.stdout.write(`Benchmark sources ready under ${path.relative(repoRoot, cacheRoot)}\n`);
