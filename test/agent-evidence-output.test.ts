import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { writeCanonicalAgentEvidenceV5 } from '../src/contracts/write-agent-evidence-v5.js';

describe('Agent Evidence V5 sidecar', () => {
  it('writes the strict canonical sidecar next to a completed Engine report', async () => {
    const out = await mkdtemp(path.join(tmpdir(), 'viewportable-agent-evidence-'));

    try {
      const outputPath = await writeCanonicalAgentEvidenceV5(out, {
        mode: 'compare',
        exitCode: 1,
        outcome: 'findings',
        reportPath: path.join(out, 'structural-diff.json'),
        stderr: '',
        report: {
          summary: {
            viewportsChecked: 4,
            introducedRanges: 1,
            resolvedRanges: 0,
          },
          findings: [
            {
              id: 'finding-1',
              direction: 'introduced',
              type: 'disappearance',
              exactRange: { minWidth: 350, maxWidth: 499 },
            },
          ],
        },
      });

      expect(outputPath).toBe(path.join(out, 'agent-evidence.json'));
      const evidence = JSON.parse(await readFile(outputPath, 'utf8'));
      expect(evidence).toMatchObject({
        schemaVersion: 'viewportable.agent-evidence.v5',
        mode: 'compare',
        outcome: 'findings',
        exitCode: 1,
        findings: [
          {
            id: 'finding-1',
            type: 'disappearance',
            repair: {
              repairable: false,
              reason: 'unsupported-finding',
            },
          },
        ],
      });
    } finally {
      await rm(out, { recursive: true, force: true });
    }
  });
});
