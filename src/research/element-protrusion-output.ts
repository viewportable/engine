import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { detectElementProtrusionCandidates } from '../analyze/element-protrusion.js';
import type { LayoutNode } from '../types.js';

export interface ElementProtrusionResearchSample {
  width: number;
  nodes: LayoutNode[];
}

export async function writeElementProtrusionResearch(
  outDir: string,
  samples: ElementProtrusionResearchSample[],
): Promise<string> {
  const ordered = [...samples].sort((first, second) => first.width - second.width);
  const candidates = ordered.flatMap((sample) =>
    detectElementProtrusionCandidates(sample.nodes, sample.width),
  );
  const outputPath = path.join(outDir, 'element-protrusion.json');

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
