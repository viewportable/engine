import { z } from 'zod';

const horizontalOverflowIssueSchema = z.object({
  id: z.string().min(1),
  type: z.literal('horizontal-overflow'),
  severity: z.literal('error'),
  selector: z.string().min(1),
  tagName: z.string().min(1),
  side: z.enum(['right', 'left']),
  overflowPx: z.number().int().positive(),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  viewportWidth: z.number().int().positive(),
  rootCauseId: z.string().min(1).optional(),
  evidence: z.object({
    documentScrollWidth: z.number().nonnegative(),
    documentClientWidth: z.number().nonnegative(),
    elementRight: z.number(),
    computedStyles: z.object({
      display: z.string(),
      position: z.string(),
      'overflow-x': z.string(),
    }),
    nearestScrollableAncestor: z.string().nullable(),
  }),
});

const fixedElementCollisionIssueSchema = z.object({
  id: z.string().min(1),
  type: z.literal('fixed-element-collision'),
  severity: z.literal('error'),
  selector: z.string().min(1),
  otherSelector: z.string().min(1),
  tagName: z.string().min(1),
  otherTagName: z.string().min(1),
  overlapWidthPx: z.number().int().positive(),
  overlapHeightPx: z.number().int().positive(),
  overlapAreaPx: z.number().int().positive(),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  otherBbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  viewportWidth: z.number().int().positive(),
  evidence: z.object({
    position: z.literal('fixed'),
    otherPosition: z.literal('fixed'),
    zIndex: z.string(),
    otherZIndex: z.string(),
  }),
});

const wrappingIssueSchema = z.object({
  id: z.string().min(1),
  type: z.literal('wrapping'),
  severity: z.literal('error'),
  selector: z.string().min(1),
  parentSelector: z.string().min(1),
  tagName: z.string().min(1),
  parentTagName: z.string().min(1),
  viewportWidth: z.number().int().positive(),
  previousViewportWidth: z.number().int().positive(),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  evidence: z.object({
    previousRowSize: z.number().int().min(3),
    currentRowSize: z.number().int().positive(),
    stableSiblingCount: z.number().int().min(2),
    previousRowIndex: z.number().int().nonnegative(),
    currentRowIndex: z.number().int().positive(),
    verticalShiftPx: z.number().int().positive(),
  }),
});

const fixedContentOcclusionIssueSchema = z.object({
  id: z.string().min(1),
  type: z.literal('fixed-content-occlusion'),
  severity: z.literal('error'),
  selector: z.string().min(1),
  targetSelector: z.string().min(1),
  tagName: z.string().min(1),
  targetTagName: z.string().min(1),
  overlapWidthPx: z.number().int().positive(),
  overlapHeightPx: z.number().int().positive(),
  overlapAreaPx: z.number().int().positive(),
  targetCoveragePct: z.number().int().min(1).max(100),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  targetBbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  viewportWidth: z.number().int().positive(),
  evidence: z.object({
    position: z.literal('fixed'),
    targetPosition: z.string(),
    zIndex: z.string(),
    targetZIndex: z.string(),
    paintOrder: z.number().int().nonnegative(),
    targetPaintOrder: z.number().int().nonnegative(),
  }),
});

export const issueSchema = z.discriminatedUnion('type', [
  horizontalOverflowIssueSchema,
  fixedElementCollisionIssueSchema,
  fixedContentOcclusionIssueSchema,
  wrappingIssueSchema,
]);

export const viewportResultSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  status: z.enum(['pass', 'fail']),
  issues: z.array(issueSchema),
  suppressedIssues: z.array(issueSchema),
});

export const boundaryResultSchema = z.object({
  issueId: z.string().min(1),
  issueType: z.enum([
    'horizontal-overflow',
    'fixed-element-collision',
    'fixed-content-occlusion',
    'wrapping',
  ]),
  boundary: z.number().int().positive(),
  lastGoodWidth: z.number().int().positive(),
  firstBadWidth: z.number().int().positive(),
  probesUsed: z.number().int().nonnegative(),
});

const cssSourceReferenceSchema = z.object({
  stylesheet: z.string().nullable(),
  selector: z.string().min(1),
  property: z.string().min(1),
  value: z.string().min(1),
});

const rootCauseDiagnosisSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('min-width-constraint'),
    property: z.literal('min-width'),
    value: z.string().min(1),
    suggestion: z.string().min(1),
    source: cssSourceReferenceSchema.nullable(),
  }),
  z.object({
    kind: z.literal('fixed-width-constraint'),
    property: z.literal('width'),
    value: z.string().min(1),
    suggestion: z.string().min(1),
    source: cssSourceReferenceSchema,
  }),
]);

const rootCauseObservationSchema = z.object({
  viewportWidth: z.number().int().positive(),
  overflowPx: z.number().int().positive(),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  issueIds: z.array(z.string().min(1)).min(1),
  computedWidthPx: z.number().int().nonnegative(),
  availableWidthPx: z.number().int().nonnegative(),
});

const rootCauseBoundarySchema = z.object({
  boundary: z.number().int().positive(),
  lastGoodWidth: z.number().int().positive(),
  firstBadWidth: z.number().int().positive(),
  probesUsed: z.number().int().nonnegative(),
});

const rootCauseSchema = z.object({
  id: z.string().min(1),
  type: z.literal('horizontal-overflow'),
  severity: z.literal('error'),
  selector: z.string().min(1),
  tagName: z.string().min(1),
  side: z.enum(['right', 'left']),
  issueIds: z.array(z.string().min(1)).min(2),
  observations: z.array(rootCauseObservationSchema).min(1),
  boundaries: z.array(rootCauseBoundarySchema),
  diagnosis: rootCauseDiagnosisSchema.optional(),
});

export const resultsSchema = z.object({
  version: z.literal(1),
  url: z.string().min(1),
  timestamp: z.string().datetime(),
  userAgent: z.string().min(1),
  summary: z.object({
    viewportsChecked: z.number().int().nonnegative(),
    passed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    totalIssues: z.number().int().nonnegative(),
    suppressedIssues: z.number().int().nonnegative(),
    rootCauseGroups: z.number().int().nonnegative(),
    durationMs: z.number().int().nonnegative(),
  }),
  viewports: z.array(viewportResultSchema),
  boundaries: z.array(boundaryResultSchema),
  rootCauses: z.array(rootCauseSchema),
});
