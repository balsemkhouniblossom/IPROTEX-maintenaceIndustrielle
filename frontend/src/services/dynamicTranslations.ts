export type DynamicTranslationEntityType = "workOrder";
export type DynamicTranslationField =
  "description" | "reschedule_reason" | "lifecycle_history.reason";

export type DynamicTranslationReference = {
  entityType: DynamicTranslationEntityType;
  entityId: string;
  fields: DynamicTranslationField[];
};

export type DynamicTranslationResult = {
  entityType: DynamicTranslationEntityType;
  entityId: string;
  field: string;
  originalText: string;
  translatedText: string;
  targetLocale: string;
  status: "original" | "cache_hit" | "translated" | "fallback";
  automaticallyTranslated: boolean;
  safetyNotice: boolean;
};

export type DynamicTranslationBatchResponse = {
  items: DynamicTranslationResult[];
};

export type DynamicTranslationMap = Record<string, DynamicTranslationResult>;
type DynamicTranslationsApiService = {
  batchDynamicTranslations: (
    input: {
      targetLocale: string;
      sourceLocale?: string;
      items: DynamicTranslationReference[];
    },
    options: { signal?: AbortSignal },
  ) => Promise<{ data: DynamicTranslationBatchResponse }>;
};

type VisibleWorkOrderTranslationInput = {
  _id?: string;
  description?: string;
  reschedule_reason?: string;
  lifecycle_history?: Array<{ reason?: string }>;
};

export function dynamicTranslationKey(
  entityType: DynamicTranslationEntityType,
  entityId: string,
  field: string,
): string {
  return `${entityType}:${entityId}:${field}`;
}

export function buildVisibleWorkOrderTranslationReferences(
  workOrders: VisibleWorkOrderTranslationInput[],
): DynamicTranslationReference[] {
  const seen = new Set<string>();
  const references: DynamicTranslationReference[] = [];
  for (const workOrder of workOrders) {
    if (!workOrder._id || seen.has(workOrder._id)) {
      continue;
    }
    const fields: DynamicTranslationField[] = [];
    if (workOrder.description?.trim()) fields.push("description");
    if (workOrder.reschedule_reason?.trim()) fields.push("reschedule_reason");
    if (workOrder.lifecycle_history?.some((entry) => entry.reason?.trim())) {
      fields.push("lifecycle_history.reason");
    }
    if (!fields.length) continue;

    seen.add(workOrder._id);
    references.push({
      entityType: "workOrder",
      entityId: workOrder._id,
      fields,
    });
  }
  return references;
}

export function mergeTranslationResults(
  current: DynamicTranslationMap,
  results: DynamicTranslationResult[],
): DynamicTranslationMap {
  const next = { ...current };
  for (const result of results) {
    next[
      dynamicTranslationKey(result.entityType, result.entityId, result.field)
    ] = result;
  }
  return next;
}

export function translatedTextFor(params: {
  translations: DynamicTranslationMap;
  entityType: DynamicTranslationEntityType;
  entityId: string;
  field: string;
  originalText?: string;
  showOriginal: boolean;
}): string {
  if (params.showOriginal) return params.originalText ?? "";
  const translation =
    params.translations[
      dynamicTranslationKey(params.entityType, params.entityId, params.field)
    ];
  return translation?.translatedText || params.originalText || "";
}

export async function requestDynamicTranslations(
  input: {
    targetLocale: string;
    sourceLocale?: string;
    items: DynamicTranslationReference[];
  },
  signal?: AbortSignal,
  apiClient?: DynamicTranslationsApiService,
): Promise<DynamicTranslationBatchResponse> {
  const client = apiClient ?? (await import("./api")).apiService;
  const response = await client.batchDynamicTranslations(input, { signal });
  return response.data;
}
