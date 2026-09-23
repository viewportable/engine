export const AGENT_EVIDENCE_SCHEMA_VERSION_V5 = 'viewportable.agent-evidence.v5';

export function canonicalRepairPolicies(agentEvidence) {
  const policies = new Map();

  if (
    agentEvidence?.schemaVersion !== AGENT_EVIDENCE_SCHEMA_VERSION_V5 ||
    !Array.isArray(agentEvidence.findings)
  ) {
    return policies;
  }

  for (const finding of agentEvidence.findings) {
    const repair = finding?.repair;
    if (
      typeof finding?.id !== 'string' ||
      !repair ||
      typeof repair.repairable !== 'boolean' ||
      typeof repair.reason !== 'string'
    ) {
      continue;
    }

    policies.set(finding.id, {
      repairable: repair.repairable,
      reason: repair.reason,
    });
  }

  return policies;
}

export function canonicalRepairPolicyForGroup(agentEvidence, groupId) {
  if (
    agentEvidence?.schemaVersion !== AGENT_EVIDENCE_SCHEMA_VERSION_V5 ||
    !Array.isArray(agentEvidence.findings) ||
    typeof groupId !== 'string'
  ) {
    return null;
  }

  const repairs = agentEvidence.findings
    .filter((finding) => finding?.id === groupId || finding?.groupId === groupId)
    .map((finding) => finding?.repair)
    .filter(
      (repair) =>
        repair && typeof repair.repairable === 'boolean' && typeof repair.reason === 'string',
    );

  if (repairs.length === 0) return null;

  const first = repairs[0];
  const consistent = repairs.every(
    (repair) => repair.repairable === first.repairable && repair.reason === first.reason,
  );

  return consistent
    ? {
        repairable: first.repairable,
        reason: first.reason,
      }
    : null;
}

export function repairPolicyText(repair) {
  if (!repair) return 'Repair policy unavailable';
  if (repair.repairable) return 'Auto-repairable';
  return `Manual review · ${repair.reason}`;
}

export function repairPolicyCounts(agentEvidence) {
  const policies = canonicalRepairPolicies(agentEvidence);
  let repairable = 0;
  let manual = 0;

  for (const repair of policies.values()) {
    if (repair.repairable) repairable += 1;
    else manual += 1;
  }

  return {
    total: policies.size,
    repairable,
    manual,
  };
}
