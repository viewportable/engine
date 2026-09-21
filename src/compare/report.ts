import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { StructuralCompareReport } from './run.js';

export async function writeStructuralCompareReport(
  outDir: string,
  report: StructuralCompareReport,
): Promise<string> {
  await mkdir(outDir, { recursive: true });

  const outputPath = path.join(outDir, 'structural-diff.json');
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  return outputPath;
}
