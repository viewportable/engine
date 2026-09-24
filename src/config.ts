import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { isOriginRelativeProjectRoute } from './project-route.js';

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

const projectRouteSchema = z.string().min(1).refine(isOriginRelativeProjectRoute, {
  message: 'route must be an origin-relative path beginning with one /',
});

const projectRoutesSchema = z
  .array(projectRouteSchema)
  .min(1)
  .refine((routes) => new Set(routes).size === routes.length, {
    message: 'routes must not contain duplicates',
  });

const routeDiscoveryFileSchema = z
  .string()
  .min(1)
  .refine(
    (value) =>
      !value.startsWith('/') &&
      !value.startsWith('./') &&
      !value.endsWith('/') &&
      !value.includes('\\') &&
      !value.includes('//') &&
      !value.split('/').includes('..'),
    {
      message:
        'route discovery file must be a normalized repo-relative file path without ./, .., //, trailing /, or backslashes',
    },
  );

const nextJsDistDirSchema = z
  .string()
  .min(1)
  .refine(
    (value) =>
      !value.startsWith('/') &&
      !value.startsWith('./') &&
      !value.endsWith('/') &&
      !value.includes('\\') &&
      !value.includes('//') &&
      !value.split('/').includes('..'),
    {
      message:
        'Next.js distDir must be a normalized repo-relative directory without ./, .., //, trailing /, or backslashes',
    },
  );

const nextJsRouteDiscoverySchema = z
  .object({
    distDir: nextJsDistDirSchema,
  })
  .strict();

const routeDiscoverySchema = z
  .object({
    files: z.array(routeDiscoveryFileSchema).min(1).optional(),
    sitemaps: z.array(projectRouteSchema).min(1).optional(),
    nextjs: z.array(nextJsRouteDiscoverySchema).min(1).optional(),
  })
  .strict()
  .refine(
    (value) =>
      (value.files?.length ?? 0) +
        (value.sitemaps?.length ?? 0) +
        (value.nextjs?.length ?? 0) >
      0,
    {
      message: 'routeDiscovery requires at least one file, sitemap, or Next.js manifest source',
    },
  );

const routeImpactPathSchema = z
  .string()
  .min(1)
  .refine(
    (value) =>
      !value.startsWith('/') &&
      !value.startsWith('./') &&
      !value.includes('\\') &&
      !value.includes('//') &&
      !value.split('/').includes('..'),
    {
      message:
        'impact path must be a normalized repo-relative file or directory prefix without ./, .., //, or backslashes',
    },
  );

const routeImpactRuleSchema = z
  .object({
    paths: z.array(routeImpactPathSchema).min(1),
    routes: z.union([z.literal('all'), z.array(projectRouteSchema).min(1)]),
  })
  .strict();

const sliceConfigSchema = z
  .object({
    widths: z.array(z.number().int().positive()).min(1).optional(),
    height: z.number().int().positive().optional(),
    out: z.string().min(1).optional(),
    boundary: z.boolean().optional(),
    timeout: z.number().int().positive().optional(),
    wait: z.number().int().nonnegative().optional(),
    readySelector: z.string().min(1).optional(),
    routes: projectRoutesSchema.optional(),
    routeDiscovery: routeDiscoverySchema.optional(),
    routeImpact: z.array(routeImpactRuleSchema).min(1).optional(),
    ignore: z.array(suppressionRuleSchema).default([]),
  })
  .strict()
  .superRefine((config, context) => {
    if (!config.routeImpact) return;

    if (!config.routes && !config.routeDiscovery) {
      context.addIssue({
        code: 'custom',
        path: ['routeImpact'],
        message: 'routeImpact requires routes or routeDiscovery',
      });
      return;
    }

    if (config.routeDiscovery) return;

    const configuredRoutes = new Set(config.routes ?? []);
    for (const [ruleIndex, rule] of config.routeImpact.entries()) {
      if (rule.routes === 'all') continue;

      for (const route of rule.routes) {
        if (configuredRoutes.has(route)) continue;

        context.addIssue({
          code: 'custom',
          path: ['routeImpact', ruleIndex, 'routes'],
          message: `routeImpact references unconfigured route: ${route}`,
        });
      }
    }
  });

export type SuppressionRule = z.infer<typeof suppressionRuleSchema>;
export type RouteImpactRule = z.infer<typeof routeImpactRuleSchema>;
export type RouteDiscoveryConfig = z.infer<typeof routeDiscoverySchema>;
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

    throw new Error(`Could not read Viewportable Engine config at ${configPath}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(`Invalid JSON in Viewportable Engine config at ${configPath}`);
  }

  const result = sliceConfigSchema.safeParse(parsed);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid Viewportable Engine config at ${configPath}: ${details}`);
  }

  return {
    config: result.data,
    path: configPath,
  };
}
