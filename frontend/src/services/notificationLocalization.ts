export interface LegacyNotificationTranslation {
  key: "templates.workOrderOverdueThreeDays" | "templates.workOrderOverdueSevenDays";
  params: { workOrder: string };
}

export function legacyNotificationTranslation(
  title: string,
): LegacyNotificationTranslation | null {
  const match = /^Escalation\s+([37])\+\s+days overdue for\s+([^\r\n]+)$/i.exec(
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
