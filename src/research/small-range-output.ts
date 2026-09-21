import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  detectSmallRangeOverlapCandidates,
  type SmallRangeOverlapSample,
} from '../analyze/small-range-overlap.js';

export async function writeSmallRangeOverlapResearch(
  outDir: string,
  samples: SmallRangeOverlapSample[],
): Promise<string> {
  const ordered = [...samples].sort((first, second) => first.width - second.width);
  const candidates = detectSmallRangeOverlapCandidates(ordered);
  const outputPath = path.join(outDir, 'small-range-overlap.json');

  await mkdir(outDir, { recursive: true });
  await writeFile(
    outputPath,
    `${JSON.stringify(
      {
        version: 1,
        widths: ordered.map((sample) => sample.width),
        candidates,
      },
      null,
      2,
    )}\n`,
  );

  return outputPath;
}
