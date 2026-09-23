export interface LegacyNotificationTranslation {
  key: "templates.workOrderOverdueThreeDays" | "templates.workOrderOverdueSevenDays";
  params: { workOrder: string };
}

export function legacyNotificationTranslation(
  title: string,
): LegacyNotificationTranslation | null {
  const match = /^Escalation\s+(3|7)\+\s+days overdue for\s+(.+)$/i.exec(
    title.trim(),
  );
  if (!match) return null;

  return {
    key:
      match[1] === "7"
        ? "templates.workOrderOverdueSevenDays"
        : "templates.workOrderOverdueThreeDays",
    params: { workOrder: match[2].trim() },
  };
}
