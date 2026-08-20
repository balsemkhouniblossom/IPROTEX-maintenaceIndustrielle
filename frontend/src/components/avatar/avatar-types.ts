export type TimeOfDay = "morning" | "afternoon" | "evening" | "night";

export type Season = "spring" | "summer" | "autumn" | "winter";

export type AvatarRole = "OPERATOR" | "TECHNICIAN" | "ADMIN";

export type AvatarHemisphere = "northern" | "southern";

export type ClothingMode = "season" | "weather" | "manual";

export type SleeveStyle = "short" | "long-light" | "long" | "jacket";

export type AvatarDataStatus = "loading" | "ready" | "error";

export type AvatarMessageKey =
  | "loading"
  | "ready"
  | "overdue"
  | "dueToday"
  | "inProgress"
  | "waitingValidation"
  | "assigned"
  | "clear";

export type AvatarActionKey =
  | "reviewOverdue"
  | "startMaintenance"
  | "continueTask"
  | "viewReports"
  | "viewCalendar";

export interface AvatarEnvironmentConfig {
  hemisphere: AvatarHemisphere;
  enableSeasonalClothing: boolean;
  enableTimeOfDayAppearance: boolean;
  enableAnimations: boolean;
  clothingMode: ClothingMode;
}

export interface AvatarStats {
  assigned?: number;
  dueToday?: number;
  overdue?: number;
  waitingValidation?: number;
  inProgress?: number;
  completedToday?: number;
}

export interface AvatarMessageSelection {
  messageKey: AvatarMessageKey;
  actionKey?: AvatarActionKey;
  count?: number;
}

export type MiniAvatarAssistantProps = Readonly<{
  userName?: string;
  role?: string;
  stats?: AvatarStats;
  status?: AvatarDataStatus;
  currentShift?: "morning" | "afternoon" | "night" | null;
  environmentConfig?: Partial<AvatarEnvironmentConfig>;
  onAction?: (action: AvatarActionKey) => void;
  variant?: "card" | "embedded";
  className?: string;
}>;
