export type CorrectiveWorkflowInput = {
  machineId?: string;
  faultCode?: string;
  selectedActions?: string[];
  selectedSymptoms?: string[];
  comments?: string;
  resultLabel?: string;
};

export type CorrectiveWorkflowValidation = {
  canSubmit: boolean;
  progress: number;
  missingFields: string[];
  actions: string[];
};

export const CORRECTIVE_REQUIRED_FIELDS = {
  machine: "machine",
  faultOrSymptoms: "faultOrSymptoms",
  reportDetail: "reportDetail",
} as const;

function cleanList(items: string[] | undefined): string[] {
  return Array.from(new Set((items || []).map((item) => item.trim()).filter(Boolean)));
}

export function deriveCorrectiveReportActions(input: CorrectiveWorkflowInput): string[] {
  const selectedActions = cleanList(input.selectedActions);
  if (selectedActions.length > 0) return selectedActions;

  const selectedSymptoms = cleanList(input.selectedSymptoms);
  if (selectedSymptoms.length > 0) return selectedSymptoms;

  const comment = input.comments?.trim();
  if (comment) return [comment];

  const resultLabel = input.resultLabel?.trim();
  return resultLabel ? [resultLabel] : [];
}

export function validateCorrectiveWorkflow(input: CorrectiveWorkflowInput): CorrectiveWorkflowValidation {
  const actions = deriveCorrectiveReportActions(input);
  const symptoms = cleanList(input.selectedSymptoms);
  const checks = [
    { key: CORRECTIVE_REQUIRED_FIELDS.machine, complete: Boolean(input.machineId?.trim()) },
    { key: CORRECTIVE_REQUIRED_FIELDS.faultOrSymptoms, complete: Boolean(input.faultCode?.trim()) || symptoms.length > 0 },
    { key: CORRECTIVE_REQUIRED_FIELDS.reportDetail, complete: actions.length > 0 },
  ];
  const missingFields = checks.filter((check) => !check.complete).map((check) => check.key);
  const canSubmit = missingFields.length === 0;

  return {
    canSubmit,
    progress: canSubmit ? 100 : Math.round((checks.length - missingFields.length) / checks.length * 100),
    missingFields,
    actions,
  };
}
