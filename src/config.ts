import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

export const DEFAULT_CONFIG_FILENAME = 'slice.config.json';

const horizontalOverflowSuppressionSchema = z.object({
  type: z.literal('horizontal-overflow'),
  selector: z.string().min(1),
  side: z.enum(['right', 'left']).optional(),
});

const fixedElementCollisionSuppressionSchema = z.object({
  type: z.literal('fixed-element-collision'),
  selector: z.string().min(1),
  otherSelector: z.string().min(1),
});

const fixedContentOcclusionSuppressionSchema = z.object({
  type: z.literal('fixed-content-occlusion'),
  selector: z.string().min(1),
  targetSelector: z.string().min(1),
});

const wrappingSuppressionSchema = z.object({
  type: z.literal('wrapping'),
  selector: z.string().min(1),
  parentSelector: z.string().min(1).optional(),
});

export const suppressionRuleSchema = z.discriminatedUnion('type', [
  horizontalOverflowSuppressionSchema,
  fixedElementCollisionSuppressionSchema,
  fixedContentOcclusionSuppressionSchema,
  wrappingSuppressionSchema,
]);

const sliceConfigSchema = z
  .object({
    widths: z.array(z.number().int().positive()).min(1).optional(),
    height: z.number().int().positive().optional(),
    out: z.string().min(1).optional(),
    boundary: z.boolean().optional(),
    timeout: z.number().int().positive().optional(),
    wait: z.number().int().nonnegative().optional(),
    readySelector: z.string().min(1).optional(),
    ignore: z.array(suppressionRuleSchema).default([]),
  })
  .strict();

export type SuppressionRule = z.infer<typeof suppressionRuleSchema>;
export type SliceConfig = z.infer<typeof sliceConfigSchema>;

export interface LoadedSliceConfig {
  config: SliceConfig;
  path: string | null;
}

function isEnoent(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  );
}

export async function loadSliceConfig(explicitPath?: string): Promise<LoadedSliceConfig> {
  const configPath = path.resolve(explicitPath ?? DEFAULT_CONFIG_FILENAME);
  let content: string;

  try {
    content = await readFile(configPath, 'utf8');
  } catch (error) {
    if (!explicitPath && isEnoent(error)) {
      return {
        config: sliceConfigSchema.parse({}),
        path: null,
      };
    }

    throw new Error(`Could not read Slice config at ${configPath}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(`Invalid JSON in Slice config at ${configPath}`);
  }

  const result = sliceConfigSchema.safeParse(parsed);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid Slice config at ${configPath}: ${details}`);
  }

  return {
    config: result.data,
    path: configPath,
  };
}
