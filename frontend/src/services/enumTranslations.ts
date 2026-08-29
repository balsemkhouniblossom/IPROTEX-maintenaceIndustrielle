type Translator = {
  (key: string): string;
  has?: (key: string) => boolean;
};

export type EnumTranslationCategory =
  | "roles"
  | "permissions"
  | "workOrderStatuses"
  | "priorities"
  | "maintenanceTypes"
  | "machineStates"
  | "reportTypes"
  | "notificationTypes";

const NORMALIZED_VALUE_ALIASES: Record<string, string> = {
  administrator: "admin",
  pending_validation: "waiting_validation",
  waiting_for_validation: "waiting_validation",
  waitingvalidation: "waiting_validation",
  wait_parts: "waiting_parts",
};

export function normalizeEnumValue(value: unknown): string {
  const normalized = enumValueToString(value)
    .trim()
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .replace(/[\s-]+/g, "_")
    .replace(/\W/g, "")
    .replace(/_+/g, "_")
    .toLowerCase();

  return NORMALIZED_VALUE_ALIASES[normalized] ?? normalized;
}

export function translateEnumValue(
  tEnums: Translator,
  category: EnumTranslationCategory,
  value: unknown,
): string {
  const normalized = normalizeEnumValue(value);
  if (!normalized) return "";

  const key = `${category}.${normalized}`;
  return tEnums.has?.(key) ? tEnums(key) : enumValueToString(value);
}

function enumValueToString(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return value.toString();
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "bigint") return value.toString();
  return "";
}
