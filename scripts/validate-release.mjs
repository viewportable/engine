import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const expectedTag = process.argv[2] ?? null;

async function read(relativePath) {
  return readFile(path.join(root, relativePath), 'utf8');
}

async function requireFile(relativePath) {
  try {
    await access(path.join(root, relativePath));
  } catch {
    throw new Error(`Release requires ${relativePath}`);
  }
}

const packageJson = JSON.parse(await read('package.json'));

if (packageJson.name !== '@viewportable/slice') {
  throw new Error('package.json name must be @viewportable/slice');
}

if (packageJson.bin?.slice !== './dist/cli.mjs') {
  throw new Error('package.json must expose ./dist/cli.mjs as bin.slice');
}

if (packageJson.bin?.['viewportable-mcp'] !== './dist/mcp.mjs') {
  throw new Error('package.json must expose ./dist/mcp.mjs as bin.viewportable-mcp');
}

if (packageJson.license !== 'AGPL-3.0-only') {
  throw new Error('package.json license must be AGPL-3.0-only');
}

if (packageJson.private !== true) {
  throw new Error(
    'npm publication safety changed: package.json private must remain true until publishing is explicitly approved',
  );
}

for (const required of [
  'LICENSE',
  'README.md',
  'CHANGELOG.md',
  'RELEASE.md',
  'action.yml',
  'package-lock.json',
  'tsdown.config.ts',
  'src/cli.ts',
  'src/mcp.ts',
  'src/mcp-server.ts',
  'src/mcp-runner.ts',
  'src/contracts/agent-evidence.ts',
  'src/contracts/build-agent-evidence.ts',
  'src/contracts/agent-evidence-v2.ts',
  'src/contracts/build-agent-evidence-v2.ts',
  'src/contracts/agent-evidence-v3.ts',
  'src/contracts/build-agent-evidence-v3.ts',
  'src/contracts/agent-evidence-v4.ts',
  'src/contracts/build-agent-evidence-v4.ts',
  'src/contracts/agent-evidence-v5.ts',
  'src/contracts/build-agent-evidence-v5.ts',
  'src/contracts/write-agent-evidence-v5.ts',
  'src/contracts/project-agent-evidence-v1.ts',
  'src/project-scan.ts',
  'src/changed-scope.ts',
  'src/project-route.ts',
  'src/route-discovery.ts',
  'src/nextjs-route-manifest.ts',
  'src/css-source-location.ts',
  'src/css-source-map.ts',
  'src/compare/source-attribution.ts',
  'docs/contracts/agent-evidence-v1.md',
  'docs/contracts/agent-evidence-v2.md',
  'docs/contracts/agent-evidence-v3.md',
  'docs/contracts/agent-evidence-v4.md',
  'docs/contracts/agent-evidence-v5.md',
  'docs/contracts/project-agent-evidence-v1.md',
  'scripts/github-summary.mjs',
  'scripts/github-pr-comment.mjs',
  'scripts/github-check-run.mjs',
  'scripts/github-annotations.mjs',
  'scripts/github-repair-policy.mjs',
  'scripts/github-app-v5-result-acceptance.mjs',
  'scripts/build-tool-source-map-acceptance.mjs',
  'scripts/build-tool-agent-repair-e2e.mjs',
  'scripts/agent-repair-coverage-matrix.mjs',
  'scripts/build-tool-scan-agent-repair-e2e.mjs',
  'scripts/scan-agent-repair-coverage-matrix.mjs',
  'test/fixtures/build-tool-source-map/vite.config.mjs',
  'test/fixtures/build-tool-source-map/src/Candidate.source.scss',
  'test/fixtures/build-tool-source-map/src/Candidate.width.source.scss',
  'test/fixtures/build-tool-source-map/scan.html',
  'test/fixtures/build-tool-source-map/src/scan.js',
  'test/fixtures/build-tool-source-map/src/Scan.source.scss',
  'test/fixtures/build-tool-source-map/src/Scan.width.source.scss',
  'examples/github/compare.yml',
  'examples/github/action-project.config.json',
  'examples/github/action-project.routes.txt',
  'examples/github/nextjs-fixture/.next/server/pages-manifest.json',
  'examples/github/nextjs-fixture/.next/server/app-paths-manifest.json',
  'examples/github/nextjs-fixture/.next/app-path-routes-manifest.json',
  'examples/demo-site/project-sitemap.xml',
]) {
  await requireFile(required);
}

const action = await read('action.yml');
for (const requiredFragment of [
  'npm ci --ignore-scripts',
  'npm run build',
  'dist/cli.mjs',
  'scripts/github-summary.mjs',
  'actions/upload-artifact@v7',
  'baseline-url',
  'structural-diff.json',
  'pr-comment',
  'scripts/github-pr-comment.mjs',
  'check-run',
  'scripts/github-check-run.mjs',
  'source-root',
  'agent_evidence_path',
  'agent-evidence.json',
  'SLICE_AGENT_EVIDENCE_PATH',
  'project-results.json',
  'changed-files',
  'SLICE_CHANGED_FILES',
  '${{ inputs.out }}/routes',
]) {
  if (!action.includes(requiredFragment)) {
    throw new Error(`action.yml is missing required release fragment: ${requiredFragment}`);
  }
}

if (expectedTag) {
  if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(expectedTag)) {
    throw new Error(`Release tag must look like v0.1.0 or v0.1.0-rc.1; got ${expectedTag}`);
  }

  const packageTag = `v${packageJson.version}`;
  if (expectedTag !== packageTag) {
    throw new Error(
      `Release tag ${expectedTag} does not match package version ${packageJson.version} (expected ${packageTag})`,
    );
  }

  const [readme, example, compareExample] = await Promise.all([
    read('README.md'),
    read('examples/github/slice.yml'),
    read('examples/github/compare.yml'),
  ]);

  for (const [name, content] of [
    ['README.md', readme],
    ['examples/github/slice.yml', example],
    ['examples/github/compare.yml', compareExample],
  ]) {
    if (content.includes('viewportable/engine@main')) {
      throw new Error(`${name} still points to viewportable/engine@main for a tagged release`);
    }

    if (!content.includes(`viewportable/engine@${expectedTag}`)) {
      throw new Error(
        `${name} must contain the immutable Action reference viewportable/engine@${expectedTag}`,
      );
    }
  }
}

process.stdout.write(
  `Release layout OK · ${packageJson.name}@${packageJson.version}` +
    (expectedTag ? ` · tag ${expectedTag}` : '') +
    '\n',
);
