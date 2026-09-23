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
