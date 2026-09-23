import { describe, expect, it } from 'vitest';
import {
  canonicalRepairPolicies,
  canonicalRepairPolicyForGroup,
  repairPolicyCounts,
  repairPolicyText,
} from '../scripts/github-repair-policy.mjs';

function evidence() {
  return {
    schemaVersion: 'viewportable.agent-evidence.v5',
    findings: [
      {
        id: 'finding-a',
        groupId: 'root-1',
        repair: {
          repairable: true,
          reason: 'deterministic-authored-css',
        },
      },
      {
        id: 'finding-b',
        groupId: 'root-2',
        repair: {
          repairable: false,
          reason: 'unsupported-finding',
        },
      },
    ],
  };
}

describe('GitHub repair policy consumer', () => {
  it('consumes only Canonical Agent Evidence V5', () => {
    expect(canonicalRepairPolicies(evidence()).get('finding-a')).toEqual({
      repairable: true,
      reason: 'deterministic-authored-css',
    });
    expect(
      canonicalRepairPolicies({
        ...evidence(),
        schemaVersion: 'viewportable.agent-evidence.v4',
      }).size,
    ).toBe(0);
  });

  it('maps grouped scan findings without deriving policy from raw source fields', () => {
    expect(canonicalRepairPolicyForGroup(evidence(), 'root-1')).toEqual({
      repairable: true,
      reason: 'deterministic-authored-css',
    });
    expect(canonicalRepairPolicyForGroup(evidence(), 'missing-root')).toBeNull();
  });

  it('fails closed when grouped findings disagree', () => {
    const value = evidence();
    value.findings.push({
      id: 'finding-c',
      groupId: 'root-1',
      repair: {
        repairable: false,
        reason: 'unsupported-finding',
      },
    });

    expect(canonicalRepairPolicyForGroup(value, 'root-1')).toBeNull();
  });

  it('renders stable user-facing states and counts', () => {
    expect(repairPolicyText(null)).toBe('Repair policy unavailable');
    expect(
      repairPolicyText({
        repairable: true,
        reason: 'deterministic-authored-css',
      }),
    ).toBe('Auto-repairable');
    expect(
      repairPolicyText({
        repairable: false,
        reason: 'unsupported-finding',
      }),
    ).toBe('Manual review · unsupported-finding');
    expect(repairPolicyCounts(evidence())).toEqual({
      total: 2,
      repairable: 1,
      manual: 1,
    });
  });
});
