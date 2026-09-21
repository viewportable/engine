import type { WrappingIssue, WrappingRootCauseObservation } from '../types.js';

export interface WrappingGroup {
  key: string;
  parentSelector: string;
  parentTagName: string;
  issueIds: string[];
  observations: WrappingRootCauseObservation[];
  evidence: {
    authoredFlexWrap: boolean;
    transitionCount: number;
    repeatedAcrossWidths: boolean;
    displayValues: string[];
    flexWrapValues: string[];
  };
}

interface MutableObservation {
  viewportWidth: number;
  previousViewportWidth: number;
  issueIds: Set<string>;
  wrappedSelectors: Set<string>;
  stableSiblingCount: number;
}

interface MutableGroup {
  parentSelector: string;
  parentTagName: string;
  issueIds: Set<string>;
  observations: Map<string, MutableObservation>;
  displayValues: Set<string>;
  flexWrapValues: Set<string>;
  authoredFlexWrap: boolean;
}

function hasAuthoredFlexWrap(issue: WrappingIssue): boolean {
  const display = issue.evidence.parentDisplay.toLowerCase();
  const flexWrap = issue.evidence.parentFlexWrap.toLowerCase();

  return (
    (display === 'flex' || display === 'inline-flex') &&
    (flexWrap === 'wrap' || flexWrap === 'wrap-reverse')
  );
}

export function groupWrappingIssues(issues: WrappingIssue[]): WrappingGroup[] {
  const groups = new Map<string, MutableGroup>();

  for (const issue of issues) {
    const key = issue.parentSelector;
    let group = groups.get(key);

    if (!group) {
      group = {
        parentSelector: issue.parentSelector,
        parentTagName: issue.parentTagName,
        issueIds: new Set(),
        observations: new Map(),
        displayValues: new Set(),
        flexWrapValues: new Set(),
        authoredFlexWrap: true,
      };
      groups.set(key, group);
    }

    group.issueIds.add(issue.id);
    group.displayValues.add(issue.evidence.parentDisplay);
    group.flexWrapValues.add(issue.evidence.parentFlexWrap);
    group.authoredFlexWrap &&= hasAuthoredFlexWrap(issue);

    const transitionKey = `${issue.previousViewportWidth}->${issue.viewportWidth}`;
    let observation = group.observations.get(transitionKey);

    if (!observation) {
      observation = {
        viewportWidth: issue.viewportWidth,
        previousViewportWidth: issue.previousViewportWidth,
        issueIds: new Set(),
        wrappedSelectors: new Set(),
        stableSiblingCount: issue.evidence.stableSiblingCount,
      };
      group.observations.set(transitionKey, observation);
    }

    observation.issueIds.add(issue.id);
    observation.wrappedSelectors.add(issue.selector);
    observation.stableSiblingCount = Math.max(
      observation.stableSiblingCount,
      issue.evidence.stableSiblingCount,
    );
  }

  return [...groups.entries()].map(([key, group]) => {
    const observations = [...group.observations.values()]
      .map((observation) => ({
        viewportWidth: observation.viewportWidth,
        previousViewportWidth: observation.previousViewportWidth,
        issueIds: [...observation.issueIds],
        wrappedSelectors: [...observation.wrappedSelectors],
        stableSiblingCount: observation.stableSiblingCount,
        wrappedSiblingCount: observation.wrappedSelectors.size,
      }))
      .sort(
        (first, second) =>
          second.previousViewportWidth - first.previousViewportWidth ||
          second.viewportWidth - first.viewportWidth,
      );

    return {
      key,
      parentSelector: group.parentSelector,
      parentTagName: group.parentTagName,
      issueIds: [...group.issueIds],
      observations,
      evidence: {
        authoredFlexWrap: group.authoredFlexWrap,
        transitionCount: observations.length,
        repeatedAcrossWidths: observations.length > 1,
        displayValues: [...group.displayValues].sort(),
        flexWrapValues: [...group.flexWrapValues].sort(),
      },
    };
  });
}
