import type { SuppressionRule } from './config.js';
import type { Issue } from './types.js';

function matchesCollisionPair(
  selector: string,
  otherSelector: string,
  rule: Extract<SuppressionRule, { type: 'fixed-element-collision' }>,
): boolean {
  return (
    (rule.selector === selector && rule.otherSelector === otherSelector) ||
    (rule.selector === otherSelector && rule.otherSelector === selector)
  );
}

export function isIssueSuppressed(issue: Issue, rules: SuppressionRule[]): boolean {
  return rules.some((rule) => {
    if (rule.type !== issue.type) return false;

    if (issue.type === 'horizontal-overflow' && rule.type === 'horizontal-overflow') {
      return (
        rule.selector === issue.selector && (rule.side === undefined || rule.side === issue.side)
      );
    }

    if (issue.type === 'fixed-element-collision' && rule.type === 'fixed-element-collision') {
      return matchesCollisionPair(issue.selector, issue.otherSelector, rule);
    }

    if (issue.type === 'fixed-content-occlusion' && rule.type === 'fixed-content-occlusion') {
      return rule.selector === issue.selector && rule.targetSelector === issue.targetSelector;
    }

    if (issue.type === 'wrapping' && rule.type === 'wrapping') {
      return (
        rule.selector === issue.selector &&
        (rule.parentSelector === undefined || rule.parentSelector === issue.parentSelector)
      );
    }

    return false;
  });
}

export function partitionSuppressedIssues(
  issues: Issue[],
  rules: SuppressionRule[],
): { issues: Issue[]; suppressedIssues: Issue[] } {
  const active: Issue[] = [];
  const suppressedIssues: Issue[] = [];

  for (const issue of issues) {
    if (isIssueSuppressed(issue, rules)) {
      suppressedIssues.push(issue);
    } else {
      active.push(issue);
    }
  }

  return {
    issues: active,
    suppressedIssues,
  };
}
