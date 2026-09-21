export type WrappingReflowClassification = 'authored-reflow-candidate' | 'unclassified';

export interface WrappingReflowAssessment {
  classification: WrappingReflowClassification;
  reasons: Array<'explicit-flex-wrap'>;
}

export interface WrappingFlowEvidence {
  authoredFlexWrap: boolean;
  repeatedAcrossWidths: boolean;
}

export function assessWrappingReflow(
  evidence: WrappingFlowEvidence,
): WrappingReflowAssessment {
  if (evidence.authoredFlexWrap) {
    return {
      classification: 'authored-reflow-candidate',
      reasons: ['explicit-flex-wrap'],
    };
  }

  return {
    classification: 'unclassified',
    reasons: [],
  };
}
