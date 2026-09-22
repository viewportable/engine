import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { buildSourceAnnotations } from './github-annotations.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtureRoot = path.join(root, 'test/fixtures/build-tool-source-map');
const retainedRoot = path.join(root, '.slice/build-tool-source-map-acceptance');
const tempRoot = await mkdtemp(path.join(tmpdir(), 'viewportable-build-tool-'));
const appRoot = path.join(tempRoot, 'app');
const evidenceRoot = path.join(retainedRoot, 'evidence');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function run(command, args, { cwd = root, allowed = [0], capture = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, NO_COLOR: '1' },
      stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    });

    let stdout = '';
    let stderr = '';

    if (capture) {
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        stdout += chunk;
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk;
      });
    }

    child.once('error', reject);
    child.once('close', (code) => {
      const exitCode = code ?? 2;
      if (!allowed.includes(exitCode)) {
        reject(new Error(`${command} ${args.join(' ')} exited ${exitCode}\n${stdout}\n${stderr}`));
        return;
      }

      resolve({ code: exitCode, stdout, stderr });
    });
  });
}

async function walk(directory) {
  const result = [];
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await walk(absolute)));
    else if (entry.isFile()) result.push(absolute);
  }

  return result;
}

async function startStaticServer(directory) {
  const server = createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
      const relative = decodeURIComponent(requestUrl.pathname).replace(/^\/+/, '');
      const requested = relative || 'candidate.html';
      const absolute = path.resolve(directory, requested);
      const rootPrefix = `${path.resolve(directory)}${path.sep}`;

      if (absolute !== path.resolve(directory) && !absolute.startsWith(rootPrefix)) {
        response.writeHead(403);
        response.end('forbidden');
        return;
      }

      const body = await readFile(absolute);
      const extension = path.extname(absolute);
      const contentType =
        extension === '.html'
          ? 'text/html; charset=utf-8'
          : extension === '.js'
            ? 'text/javascript; charset=utf-8'
            : extension === '.css'
              ? 'text/css; charset=utf-8'
              : extension === '.map'
                ? 'application/json; charset=utf-8'
                : 'application/octet-stream';

      response.writeHead(200, {
        'content-type': contentType,
        'cache-control': 'no-store',
      });
      response.end(body);
    } catch {
      response.writeHead(404);
      response.end('not found');
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('fixture server did not bind');

  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

await rm(retainedRoot, { recursive: true, force: true });
await mkdir(retainedRoot, { recursive: true });
await cp(fixtureRoot, appRoot, { recursive: true });

try {
  process.stdout.write(
    'BUILD TOOL SOURCE MAP ACCEPTANCE\n' +
      'toolchain: Vite 8.3.0 + Sass 1.104.1 + React 19.3.0 + CSS Modules + PostCSS\n',
  );

  await run(
    'npm',
    ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false'],
    { cwd: appRoot },
  );

  await run('npm', ['exec', '--', 'vite', 'build'], { cwd: appRoot });

  const distRoot = path.join(appRoot, 'dist');
  const builtFiles = await walk(distRoot);
  const cssFiles = builtFiles.filter((file) => file.endsWith('.css'));
  const cssMaps = builtFiles.filter((file) => file.endsWith('.css.map'));

  assert(cssFiles.length >= 1, 'Vite build emitted no CSS asset');
  assert(cssMaps.length >= 1, 'Vite production build emitted no CSS source map');

  const candidateHtml = await readFile(path.join(distRoot, 'candidate.html'), 'utf8');
  const candidateCssHref = candidateHtml.match(/<link[^>]+href="([^"]+\.css)"/)?.[1];
  assert(candidateCssHref, 'candidate build does not reference a CSS asset');

  const candidateCssPath = path.join(distRoot, candidateCssHref.replace(/^\/+/, ''));
  const candidateCss = await readFile(candidateCssPath, 'utf8');
  assert(
    /sourceMappingURL=[^\s*]+\.css\.map/.test(candidateCss),
    'candidate CSS does not expose its production source map',
  );

  const fixtureServer = await startStaticServer(distRoot);

  try {
    const cliResult = await run(
      process.execPath,
      [
        path.join(root, 'dist/cli.mjs'),
        `${fixtureServer.baseUrl}/candidate.html`,
        '--baseline-url',
        `${fixtureServer.baseUrl}/baseline.html`,
        '--widths',
        '320,375,430,520',
        '--height',
        '900',
        '--wait',
        '0',
        '--ready-selector',
        '#subject',
        '--out',
        evidenceRoot,
      ],
      { allowed: [1], capture: true },
    );

    process.stdout.write(cliResult.stdout);
    if (cliResult.stderr) process.stderr.write(cliResult.stderr);

    const reportPath = path.join(evidenceRoot, 'structural-diff.json');
    const report = JSON.parse(await readFile(reportPath, 'utf8'));
    const finding = report.findings?.find(
      (entry) => entry.type === 'protrusion' && entry.subject?.key === 'id:subject',
    );

    assert(finding, 'expected the Vite candidate protrusion finding');
    assert(finding.exactRange?.minWidth === 350, 'expected exact lower boundary 350px');
    assert(finding.exactRange?.maxWidth === 499, 'expected exact upper boundary 499px');
    assert(finding.source?.property === 'min-width', 'expected min-width source attribution');
    assert(finding.source?.value === '400px', 'expected compiled min-width value 400px');
    assert(
      finding.source?.location?.coordinateSpace === 'stylesheet',
      'expected browser-proven generated stylesheet coordinates',
    );

    const authored = finding.source?.authoredLocation;
    assert(authored, 'real Vite/Sass build did not produce authored source-map evidence');
    assert(
      authored.coordinateSpace === 'authored-source',
      'expected authored-source coordinate space',
    );
    assert(
      authored.source?.endsWith('Card.module.scss'),
      `unexpected authored source: ${authored.source}`,
    );
    assert(authored.start?.line === 21, `expected authored line 21, got ${authored.start?.line}`);
    assert(
      authored.start?.column === 5,
      `expected authored column 5, got ${authored.start?.column}`,
    );
    assert(authored.sourceMap?.version === 3, 'expected Source Map v3');
    assert(authored.sourceMap?.kind === 'external', 'expected external production CSS source map');

    const repositoryAuthoredPath = path.join(fixtureRoot, 'src/Card.module.scss');
    const repositoryAuthoredContent = await readFile(repositoryAuthoredPath, 'utf8');
    const repositoryHash = createHash('sha256').update(repositoryAuthoredContent).digest('hex');
    assert(
      authored.sourceContentSha256 === repositoryHash,
      'source-map sourcesContent does not match the checked-in authored SCSS',
    );

    const annotations = await buildSourceAnnotations(report, {
      repositoryRoot: root,
    });

    assert(annotations.annotations.length === 1, 'expected one verified authored annotation');
    const annotation = annotations.annotations[0];
    assert(
      annotation.path === 'test/fixtures/build-tool-source-map/src/Card.module.scss',
      `unexpected annotation path: ${annotation.path}`,
    );
    assert(annotation.start_line === 21, `unexpected annotation line: ${annotation.start_line}`);
    assert(
      annotation.start_column === 5 && annotation.end_column === 13,
      `unexpected annotation columns: ${annotation.start_column}-${annotation.end_column}`,
    );

    const acceptance = {
      version: 1,
      toolchain: {
        vite: '8.3.0',
        sass: '1.104.1',
        react: '19.3.0',
        cssModules: true,
        postcss: true,
      },
      build: {
        candidateCss: path.relative(appRoot, candidateCssPath),
        cssSourceMapCount: cssMaps.length,
      },
      finding: {
        type: finding.type,
        exactRange: finding.exactRange,
        generated: {
          stylesheet: finding.source.stylesheet,
          location: finding.source.location,
          property: finding.source.property,
          value: finding.source.value,
        },
        authored,
      },
      githubAnnotation: annotation,
      reportPath: path.relative(root, reportPath),
    };

    await writeFile(
      path.join(retainedRoot, 'acceptance.json'),
      `${JSON.stringify(acceptance, null, 2)}\n`,
      'utf8',
    );

    process.stdout.write(
      [
        'REAL BUILD TOOL SOURCE MAP ACCEPTANCE PASS',
        `generated: ${finding.source.stylesheet}`,
        `authored: ${authored.source}:${authored.start.line}:${authored.start.column}`,
        `annotation: ${annotation.path}:${annotation.start_line}:${annotation.start_column}-${annotation.end_column}`,
        `evidence: ${path.relative(root, reportPath)}`,
        `acceptance: ${path.relative(root, path.join(retainedRoot, 'acceptance.json'))}`,
        '',
      ].join('\n'),
    );
  } finally {
    await new Promise((resolve) => fixtureServer.server.close(resolve));
  }
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
