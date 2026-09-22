import { readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

const root = path.resolve('.');
const repairAcceptancePath = path.join(root, '.slice/build-tool-scan-agent-repair/acceptance.json');
const retainedRoot = path.join(root, '.slice/scan-agent-repair-coverage-matrix');
const acceptancePath = path.join(retainedRoot, 'acceptance.json');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function runScenario(scenario) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/build-tool-scan-agent-repair-e2e.mjs'], {
      cwd: root,
      env: {
        ...process.env,
        NO_COLOR: '1',
        VIEWPORTABLE_SCAN_REPAIR_SCENARIO: scenario,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      process.stdout.write(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      process.stderr.write(chunk);
    });

    child.once('error', reject);
    child.once('close', async (code) => {
      if (code !== 0) {
        reject(new Error(`scan repair scenario ${scenario} failed with ${code}\n${stdout}\n${stderr}`));
        return;
      }

      try {
        resolve(JSON.parse(await readFile(repairAcceptancePath, 'utf8')));
      } catch (error) {
        reject(error);
      }
    });
  });
}

await rm(retainedRoot, { recursive: true, force: true });
await mkdir(retainedRoot, { recursive: true });

const cases = [];

for (const scenario of ['min-width', 'width']) {
  const acceptance = await runScenario(scenario);

  assert(acceptance.scenario === scenario, `${scenario}: scenario mismatch`);
  assert(acceptance.mode === 'scan', `${scenario}: expected scan mode`);
  assert(
    acceptance.before?.finding?.type === 'horizontal-overflow',
    `${scenario}: expected horizontal-overflow finding`,
  );
  assert(
    acceptance.before?.finding?.sourceProperty === scenario,
    `${scenario}: expected source property ${scenario}`,
  );
  assert(
    acceptance.before?.finding?.repair?.repairable === true &&
      acceptance.before?.finding?.repair?.reason === 'deterministic-authored-css',
    `${scenario}: expected canonical V5 repairable policy`,
  );
  assert(
    acceptance.repair?.editedLine > 0,
    `${scenario}: expected one deterministic authored-line edit`,
  );
  assert(acceptance.after?.outcome === 'clean', `${scenario}: expected clean rescan`);
  assert(acceptance.after?.findingCount === 0, `${scenario}: expected zero final findings`);

  cases.push({
    scenario,
    sourceProperty: acceptance.before.finding.sourceProperty,
    sourceValue: acceptance.before.finding.sourceValue,
    repair: acceptance.before.finding.repair,
    authoredLocation: acceptance.before.finding.source.authoredLocation,
    readBytes: acceptance.repair.readBytes,
    sourceBytes: acceptance.repair.sourceBytes,
    editedLine: acceptance.repair.editedLine,
    finalOutcome: acceptance.after.outcome,
    finalFindingCount: acceptance.after.findingCount,
  });
}

const result = {
  version: 1,
  cases,
  summary: {
    repairableCases: cases.length,
    cleanCases: cases.filter((item) => item.finalOutcome === 'clean').length,
  },
};

await writeFile(acceptancePath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');

process.stdout.write(
  [
    'SCAN AGENT REPAIR COVERAGE MATRIX PASS',
    ...cases.map(
      (item) =>
        `  ${item.scenario}: ${item.sourceProperty}: ${item.sourceValue} -> repairable -> clean`,
    ),
    `acceptance: ${path.relative(root, acceptancePath)}`,
    '',
  ].join('\n'),
);
