export interface RelationshipSample<State extends string> {
  width: number;
  state: State;
}

export interface RelationshipInterval<State extends string> {
  state: State;
  minSampleWidth: number;
  maxSampleWidth: number;
  sampleWidths: number[];
  sampleCount: number;
}

export interface SandwichedRelationshipInterval<State extends string> {
  interval: RelationshipInterval<State>;
  surroundingState: State;
  sampledSpanPx: number;
}

function normalizeSamples<State extends string>(
  samples: RelationshipSample<State>[],
): RelationshipSample<State>[] {
  const byWidth = new Map<number, State>();

  for (const sample of samples) {
    const existing = byWidth.get(sample.width);
    if (existing !== undefined && existing !== sample.state) {
      throw new Error(
        `Conflicting relationship states at ${sample.width}px: ${existing} vs ${sample.state}`,
      );
    }

    byWidth.set(sample.width, sample.state);
  }

  return [...byWidth.entries()]
    .map(([width, state]) => ({ width, state }))
    .sort((first, second) => first.width - second.width);
}

export function buildRelationshipIntervals<State extends string>(
  samples: RelationshipSample<State>[],
): RelationshipInterval<State>[] {
  const ordered = normalizeSamples(samples);
  const intervals: RelationshipInterval<State>[] = [];

  for (const sample of ordered) {
    const current = intervals.at(-1);

    if (current?.state === sample.state) {
      current.maxSampleWidth = sample.width;
      current.sampleWidths.push(sample.width);
      current.sampleCount += 1;
      continue;
    }

    intervals.push({
      state: sample.state,
      minSampleWidth: sample.width,
      maxSampleWidth: sample.width,
      sampleWidths: [sample.width],
      sampleCount: 1,
    });
  }

  return intervals;
}

export function findSandwichedRelationshipIntervals<State extends string>(
  intervals: RelationshipInterval<State>[],
): SandwichedRelationshipInterval<State>[] {
  const candidates: SandwichedRelationshipInterval<State>[] = [];

  for (let index = 1; index < intervals.length - 1; index += 1) {
    const previous = intervals[index - 1];
    const current = intervals[index];
    const next = intervals[index + 1];

    if (!previous || !current || !next) continue;
    if (previous.state !== next.state || current.state === previous.state) continue;

    candidates.push({
      interval: current,
      surroundingState: previous.state,
      sampledSpanPx: current.maxSampleWidth - current.minSampleWidth,
    });
  }

  return candidates;
}
