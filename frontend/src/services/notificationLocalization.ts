export interface LegacyNotificationTranslation {
  key: "templates.workOrderOverdueThreeDays" | "templates.workOrderOverdueSevenDays";
  params: { workOrder: string };
}

export function legacyNotificationTranslation(
  title: string,
): LegacyNotificationTranslation | null {
  const normalizedTitle = title.trim();
  if (normalizedTitle.includes("\n") || normalizedTitle.includes("\r")) {
    return null;
  }

  const lowerTitle = normalizedTitle.toLocaleLowerCase("en-US");
  const variants = [
    {
      prefix: "escalation 7+ days overdue for ",
      key: "templates.workOrderOverdueSevenDays" as const,
    },
    {
      prefix: "escalation 3+ days overdue for ",
      key: "templates.workOrderOverdueThreeDays" as const,
    },
  ];
  const variant = variants.find(({ prefix }) => lowerTitle.startsWith(prefix));
  if (!variant) return null;

  const workOrder = normalizedTitle.slice(variant.prefix.length).trim();
  if (!workOrder) return null;

  return {
    key: variant.key,
    params: { workOrder },
  };
}
