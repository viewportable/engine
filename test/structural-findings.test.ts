import { describe, expect, it } from 'vitest';
import { buildStructuralFindings } from '../src/compare/findings.js';
import type { StructuralChangeRange } from '../src/compare/ranges.js';

const subject = (key: string) => ({
  key,
  quality: 'explicit' as const,
  tagName: 'DIV',
});

function range(overrides: Partial<StructuralChangeRange>): StructuralChangeRange {
  return {
    fingerprint: 'fingerprint',
    kind: 'node-presence',
    direction: 'introduced',
    firstWidth: 375,
    lastWidth: 430,
    sampleWidths: [375, 430],
    sampleCount: 2,
    boundaries: [
      {
        edge: 'lower',
        boundary: 350,
        lastGoodWidth: 349,
        firstBadWidth: 350,
        probesUsed: 6,
        sampledPassWidth: 320,
        sampledFailWidth: 375,
      },
      {
        edge: 'upper',
        boundary: 499,
        lastGoodWidth: 500,
        firstBadWidth: 499,
        probesUsed: 7,
        sampledPassWidth: 520,
        sampledFailWidth: 430,
      },
    ],
    change: {
      kind: 'node-presence',
      direction: 'introduced',
      viewport: { width: 375, height: 900 },
      subject: subject('id:checkout-button'),
      baselineState: 'visible',
      candidateState: 'missing',
    },
    ...overrides,
  };
}

describe('buildStructuralFindings', () => {
  it('normalizes a disappearance into a product-facing finding with exact range', () => {
    const findings = buildStructuralFindings([range({})]);

    expect(findings).toEqual([
      expect.objectContaining({
        id: expect.stringMatching(/^structural-[0-9a-f]{12}$/),
        category: 'structural',
        type: 'disappearance',
        direction: 'introduced',
        subject: subject('id:checkout-button'),
        relatedSubjects: [],
        sampledRange: {
          minWidth: 375,
          maxWidth: 430,
          widths: [375, 430],
        },
        exactRange: {
          minWidth: 350,
          maxWidth: 499,
        },
        baseline: { state: 'visible' },
        candidate: { state: 'missing' },
        evidence: expect.objectContaining({
          fingerprint: 'fingerprint',
          sampleCount: 2,
        }),
      }),
    ]);
  });

  it('normalizes reparenting without exposing detector-specific shape to consumers', () => {
    const finding = buildStructuralFindings([
      range({
        fingerprint: 'reparent',
        kind: 'reparenting',
        change: {
          kind: 'reparenting',
          direction: 'introduced',
          viewport: { width: 375, height: 900 },
          subject: subject('id:cta'),
          baselineParent: subject('id:pricing-card'),
          candidateParent: subject('id:page-root'),
        },
      }),
    ])[0];

    expect(finding).toMatchObject({
      type: 'reparenting',
      subject: subject('id:cta'),
      relatedSubjects: [subject('id:pricing-card'), subject('id:page-root')],
      baseline: {
        state: 'parented',
        parent: subject('id:pricing-card'),
      },
      candidate: {
        state: 'parented',
        parent: subject('id:page-root'),
      },
    });
  });

  it('keeps one-sided exact evidence partial instead of inventing the other edge', () => {
    const finding = buildStructuralFindings([
      range({
        boundaries: [
          {
            edge: 'lower',
            boundary: 350,
            lastGoodWidth: 349,
            firstBadWidth: 350,
            probesUsed: 6,
            sampledPassWidth: 320,
            sampledFailWidth: 375,
          },
        ],
      }),
    ])[0];

    expect(finding?.exactRange).toEqual({ minWidth: 350 });
  });

  it('keeps deterministic ids for equivalent canonical ranges', () => {
    const first = buildStructuralFindings([range({})])[0];
    const second = buildStructuralFindings([range({})])[0];

    expect(first?.id).toBe(second?.id);
  });
});
