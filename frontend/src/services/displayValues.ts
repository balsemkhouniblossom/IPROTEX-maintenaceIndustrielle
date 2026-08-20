const MONGO_OBJECT_ID_PATTERN = /^[a-f0-9]{24}$/i;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isRawTechnicalId(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return MONGO_OBJECT_ID_PATTERN.test(trimmed) || UUID_PATTERN.test(trimmed);
}

export function displayText(value: unknown, fallback = "-"): string {
  if (value == null) return fallback;
  if (typeof value === "object") {
    if (value instanceof Date) {
      return value.toISOString();
    }
    return referenceDisplay(value, ["name", "label", "nom_complet", "machine_id", "_id", "id"], fallback);
  }
  let text: string;
  if (typeof value === "string") {
    text = value.trim();
  } else if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    text = `${value}`.trim();
  } else {
    return fallback;
  }
  if (!text || isRawTechnicalId(text)) return fallback;
  return text;
}

export function referenceDisplay(
  value: unknown,
  preferredKeys: string[],
  fallback = "-",
): string {
  if (value && typeof value === "object") {
    const item = value as Record<string, unknown>;
    for (const key of preferredKeys) {
      const label = displayText(item[key], "");
      if (label) return label;
    }
    return fallback;
  }

  return displayText(value, fallback);
}
