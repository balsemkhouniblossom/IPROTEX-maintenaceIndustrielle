export interface CorrectiveAssistantSolutionResponse {
  id: string;
  probableCause?: string;
  recommendedAction?: string;
}

export interface CorrectiveAssistantFaultResponse {
  id: string;
  code: string;
  description?: string;
  gravity?: string;
  recommendedSolutions: CorrectiveAssistantSolutionResponse[];
}

export interface CorrectiveAssistantDocumentResponse {
  id: string;
  type: string;
  fileName: string;
  filePath: string;
}

export interface CorrectiveAssistantResponse {
  machineId?: string;
  pannes: CorrectiveAssistantFaultResponse[];
  documents: CorrectiveAssistantDocumentResponse[];
}
