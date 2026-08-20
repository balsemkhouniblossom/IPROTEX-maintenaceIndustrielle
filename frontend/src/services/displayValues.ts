const RAW_TECHNICAL_ID_PATTERN =
  /^(?:[a-f0-9]{24}|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;

export function isRawTechnicalId(value: unknown): boolean {
  return typeof value === "string" && RAW_TECHNICAL_ID_PATTERN.test(value.trim());
}

export function displayText(value: unknown, fallback = "-"): string {
  if (value == null) return fallback;
  if (typeof value === "object") {
    return referenceDisplay(value, ["name", "label", "nom_complet", "machine_id", "_id", "id"], fallback);
  }
  const text = value.toString().trim();
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
