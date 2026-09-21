import { describe, expect, it } from 'vitest';
import {
  buildRelationshipIntervals,
  findSandwichedRelationshipIntervals,
} from '../src/relationships/intervals.js';

describe('buildRelationshipIntervals', () => {
  it('coalesces adjacent samples with the same state', () => {
    expect(
      buildRelationshipIntervals([
        { width: 320, state: 'same-row' },
        { width: 375, state: 'same-row' },
        { width: 390, state: 'below' },
        { width: 430, state: 'below' },
        { width: 768, state: 'same-row' },
      ]),
    ).toEqual([
      {
        state: 'same-row',
        minSampleWidth: 320,
        maxSampleWidth: 375,
        sampleWidths: [320, 375],
        sampleCount: 2,
      },
      {
        state: 'below',
        minSampleWidth: 390,
        maxSampleWidth: 430,
        sampleWidths: [390, 430],
        sampleCount: 2,
      },
      {
        state: 'same-row',
        minSampleWidth: 768,
        maxSampleWidth: 768,
        sampleWidths: [768],
        sampleCount: 1,
      },
    ]);
  });

  it('normalizes sample order and duplicate observations', () => {
    expect(
      buildRelationshipIntervals([
        { width: 430, state: 'same-row' },
        { width: 320, state: 'below' },
        { width: 430, state: 'same-row' },
        { width: 390, state: 'same-row' },
      ]),
    ).toEqual([
      {
        state: 'below',
        minSampleWidth: 320,
        maxSampleWidth: 320,
        sampleWidths: [320],
        sampleCount: 1,
      },
      {
        state: 'same-row',
        minSampleWidth: 390,
        maxSampleWidth: 430,
        sampleWidths: [390, 430],
        sampleCount: 2,
      },
    ]);
  });

  it('rejects conflicting states at one viewport width', () => {
    expect(() =>
      buildRelationshipIntervals([
        { width: 390, state: 'same-row' },
        { width: 390, state: 'below' },
      ]),
    ).toThrow('Conflicting relationship states at 390px');
  });
});

describe('findSandwichedRelationshipIntervals', () => {
  it('finds a state observed between matching stable neighboring states', () => {
    const intervals = buildRelationshipIntervals([
      { width: 768, state: 'same-row' },
      { width: 900, state: 'overlap' },
      { width: 901, state: 'overlap' },
      { width: 1024, state: 'same-row' },
    ]);

    expect(findSandwichedRelationshipIntervals(intervals)).toEqual([
      {
        interval: {
          state: 'overlap',
          minSampleWidth: 900,
          maxSampleWidth: 901,
          sampleWidths: [900, 901],
          sampleCount: 2,
        },
        surroundingState: 'same-row',
        sampledSpanPx: 1,
      },
    ]);
  });

  it('does not invent an anomaly when neighboring states differ', () => {
    const intervals = buildRelationshipIntervals([
      { width: 320, state: 'below' },
      { width: 390, state: 'same-row' },
      { width: 768, state: 'above' },
    ]);

    expect(findSandwichedRelationshipIntervals(intervals)).toEqual([]);
  });
});
