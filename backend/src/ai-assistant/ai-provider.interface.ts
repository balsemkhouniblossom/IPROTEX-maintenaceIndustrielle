/**
 * The grounded facts the assistant is allowed to reason over. Everything
 * here is read from the existing Knowledge Base, fault catalog, live device
 * monitoring, and work-order history — the provider must never be asked to
 * answer from anything else, and the prompt built from this context always
 * instructs it to say so ("uncertainty") rather than invent what's missing.
 */
export interface AiGroundedContext {
  machineName?: string;
  machineTypeName?: string;
  faultCode?: string;
  faultDescription?: string;
  faultSeverity?: string;
  probableCause?: string;
  approvedSolution?: string;
  activeAlarms: Array<{
    codePanne: string;
    severity: string;
    message?: string;
    raisedAt: string;
  }>;
  maintenanceHistory: Array<{
    date: string;
    type?: string;
    status: string;
    codePanne?: string;
    description?: string;
    rootCause?: string;
    actionTaken?: string;
  }>;
  knowledgeArticles: Array<{
    title: string;
    summary?: string;
    category: string;
  }>;
}

export interface AiAssistantRequest {
  /** Already prompt-injection-neutralized and sensitive-data-redacted. */
  question: string;
  locale: string;
  context: AiGroundedContext;
}

export interface AiAssistantAnswer {
  knownFacts: string[];
  probableCauses: string[];
  recommendedChecks: string[];
  safetyWarnings: string[];
  uncertainty: string;
}

export interface AiProviderResult {
  answer: AiAssistantAnswer;
  model: string;
}

export const AI_PROVIDER = Symbol('AI_PROVIDER');

export interface AiProvider {
  readonly name: string;
  generate(
    request: AiAssistantRequest,
    signal: AbortSignal,
  ): Promise<AiProviderResult>;
}
