import {
  canonicalRepairPolicies,
  repairPolicyCounts,
  repairPolicyText,
} from '../../../scripts/github-repair-policy.mjs';

function findingRange(finding) {
  const exact = finding.exactRange;
  if (exact?.minWidth !== undefined && exact?.maxWidth !== undefined) {
    return `${exact.minWidth}-${exact.maxWidth}px exact`;
  }

  const sampled = finding.sampledRange;
  if (!sampled) return 'unknown range';
  return sampled.minWidth === sampled.maxWidth
    ? `${sampled.minWidth}px sampled`
    : `${sampled.minWidth}-${sampled.maxWidth}px sampled`;
}

function findingText(finding) {
  if (finding.type === 'disappearance') {
    return `${finding.subject?.key ?? '?'} disappeared`;
  }
  if (finding.type === 'reparenting') {
    return `${finding.subject?.key ?? '?'} reparented ${finding.baseline?.parent?.key ?? '?'} -> ${finding.candidate?.parent?.key ?? '?'}`;
  }
  if (finding.type === 'overlap') {
    return `${finding.subject?.key ?? '?'} overlaps ${finding.relatedSubjects?.[0]?.key ?? '?'}`;
  }
  if (finding.type === 'protrusion') {
    return `${finding.subject?.key ?? '?'} protrudes from ${finding.relatedSubjects?.[0]?.key ?? '?'}`;
  }
  if (finding.type === 'appearance') {
    return `${finding.subject?.key ?? '?'} appeared`;
  }
  return finding.type ?? 'structural finding';
}

export function resultConclusion(exitCode) {
  if (Number(exitCode) === 0) return 'success';
  if (Number(exitCode) === 1) return 'failure';
  return 'action_required';
}

export function renderResult(report, exitCode, agentEvidence = null) {
  const conclusion = resultConclusion(exitCode);
  const findings = Array.isArray(report?.findings) ? report.findings : [];
  const repairPolicies = canonicalRepairPolicies(agentEvidence);
  const repairCounts = repairPolicyCounts(agentEvidence);
  const introduced = findings.filter((finding) => finding.direction === 'introduced');

  if (conclusion === 'action_required') {
    return {
      conclusion,
      title: 'Comparison could not complete',
      summary:
        'Viewportable could not complete structural comparison. Review executor evidence and retry.',
    };
  }

  if (introduced.length === 0) {
    return {
      conclusion,
      title: 'No structural regressions',
      summary: '✅ No structural regressions introduced.',
    };
  }

  const lines = [
    `❌ ${introduced.length} structural regression${introduced.length === 1 ? '' : 's'} introduced.`,
    '',
  ];

  if (repairCounts.total > 0) {
    lines.push(
      `**Repair policy:** ${repairCounts.repairable} auto-repairable · ${repairCounts.manual} manual review`,
      '',
    );
  }

  for (const finding of introduced) {
    lines.push(
      `- **${findingRange(finding)}** - ${findingText(finding)} - ${repairPolicyText(
        repairPolicies.get(finding.id),
      )}`,
    );
  }

  return {
    conclusion,
    title: `${introduced.length} structural regression${introduced.length === 1 ? '' : 's'} introduced`,
    summary: lines.join('\n'),
  };
}
