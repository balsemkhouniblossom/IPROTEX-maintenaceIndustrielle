import type {
  AvatarDataStatus,
  AvatarEnvironmentConfig,
  AvatarMessageSelection,
  AvatarRole,
  AvatarStats,
  Season,
  SleeveStyle,
  TimeOfDay,
} from "./avatar-types";

export const DEFAULT_AVATAR_ENVIRONMENT: AvatarEnvironmentConfig = {
  hemisphere: "northern",
  enableSeasonalClothing: true,
  enableTimeOfDayAppearance: true,
  enableAnimations: true,
  clothingMode: "season",
};

export const AVATAR_SESSION_DISMISSAL_KEY = "gmao-mini-avatar-message-dismissed";

export interface SessionStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const TIME_OF_DAY_CONFIG = {
  morning: { startHour: 5, endHour: 12, accent: "sunrise", lighting: "bright" },
  afternoon: { startHour: 12, endHour: 18, accent: "day", lighting: "neutral" },
  evening: { startHour: 18, endHour: 22, accent: "sunset", lighting: "warm" },
  night: { startHour: 22, endHour: 5, accent: "moon", lighting: "night" },
} as const;

export const ROLE_CONFIG = {
  OPERATOR: { uniform: "#1d4ed8", uniformDark: "#1e3a8a", badge: "operator", helmet: true },
  TECHNICIAN: { uniform: "#c2410c", uniformDark: "#9a3412", badge: "maintenance", helmet: true },
  ADMIN: { uniform: "#1e3a8a", uniformDark: "#172554", badge: "admin", helmet: false },
  NEUTRAL: { uniform: "#475569", uniformDark: "#334155", badge: "neutral", helmet: true },
} as const;

export const SEASON_CONFIG: Record<Season, { sleeves: SleeveStyle }> = {
  spring: { sleeves: "long-light" },
  summer: { sleeves: "short" },
  autumn: { sleeves: "long" },
  winter: { sleeves: "jacket" },
};

export function getTimeOfDay(dateOrHour: Date | number): TimeOfDay {
  const hour = typeof dateOrHour === "number" ? dateOrHour : dateOrHour.getHours();
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 18) return "afternoon";
  if (hour >= 18 && hour < 22) return "evening";
  return "night";
}

export function getMillisecondsUntilNextTimePeriod(date: Date): number {
  const hour = date.getHours();
  let nextBoundaryHour = 29;
  if (hour < 5) nextBoundaryHour = 5;
  else if (hour < 12) nextBoundaryHour = 12;
  else if (hour < 18) nextBoundaryHour = 18;
  else if (hour < 22) nextBoundaryHour = 22;
  const nextBoundary = new Date(date);
  nextBoundary.setHours(nextBoundaryHour, 0, 0, 0);
  return Math.max(1_000, nextBoundary.getTime() - date.getTime());
}

export function getSeason(dateOrMonth: Date | number, hemisphere: "northern" | "southern" = "northern"): Season {
  const month = typeof dateOrMonth === "number" ? dateOrMonth : dateOrMonth.getMonth();
  let northernSeason: Season = "winter";
  if (month >= 2 && month <= 4) {
    northernSeason = "spring";
  } else if (month >= 5 && month <= 7) {
    northernSeason = "summer";
  } else if (month >= 8 && month <= 10) {
    northernSeason = "autumn";
  }

  if (hemisphere === "northern") return northernSeason;
  return ({ spring: "autumn", summer: "winter", autumn: "spring", winter: "summer" } as const)[northernSeason];
}

export function getSleeveStyle(season: Season, enabled = true): SleeveStyle {
  return enabled ? SEASON_CONFIG[season].sleeves : "long-light";
}

export function normalizeAvatarRole(role?: string): AvatarRole | "NEUTRAL" {
  const normalized = role?.toUpperCase();
  return normalized === "OPERATOR" || normalized === "TECHNICIAN" || normalized === "ADMIN"
    ? normalized
    : "NEUTRAL";
}

export function getAvatarFirstName(userName?: string): string | undefined {
  const normalized = userName?.trim();
  return normalized ? normalized.split(/\s+/)[0] : undefined;
}

export function isAvatarMessageDismissed(storage: SessionStorageLike): boolean {
  return storage.getItem(AVATAR_SESSION_DISMISSAL_KEY) === "true";
}

export function dismissAvatarMessage(storage: SessionStorageLike): void {
  storage.setItem(AVATAR_SESSION_DISMISSAL_KEY, "true");
}

export function resetAvatarMessageDismissal(storage: SessionStorageLike): void {
  storage.removeItem(AVATAR_SESSION_DISMISSAL_KEY);
}

export function selectAvatarMessage(
  stats: AvatarStats | undefined,
  status: AvatarDataStatus = "ready",
): AvatarMessageSelection {
  if (status === "loading" || !stats) return { messageKey: "loading" };
  if (status === "error") return { messageKey: "ready" };
  if ((stats.overdue ?? 0) > 0) return { messageKey: "overdue", actionKey: "reviewOverdue", count: stats.overdue };
  if ((stats.dueToday ?? 0) > 0) return { messageKey: "dueToday", actionKey: "startMaintenance", count: stats.dueToday };
  if ((stats.inProgress ?? 0) > 0) return { messageKey: "inProgress", actionKey: "continueTask", count: stats.inProgress };
  if ((stats.waitingValidation ?? 0) > 0) {
    return { messageKey: "waitingValidation", actionKey: "viewReports", count: stats.waitingValidation };
  }
  if ((stats.assigned ?? 0) > 0) return { messageKey: "assigned", actionKey: "startMaintenance", count: stats.assigned };
  return { messageKey: "clear", actionKey: "viewCalendar" };
}

export function getAssistantAnimationClass(enabled: boolean, reducedMotion: boolean): string {
  return enabled && !reducedMotion ? "mini-avatar-animate" : "";
}
