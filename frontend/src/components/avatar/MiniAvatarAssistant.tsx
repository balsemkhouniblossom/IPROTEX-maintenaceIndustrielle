"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowRightIcon, CheckBadgeIcon } from "@heroicons/react/24/outline";
import { usePrefersReducedMotion, useSeason, useTimeOfDay } from "@/hooks/useTimeOfDay";
import {
  DEFAULT_AVATAR_ENVIRONMENT,
  getAvatarFirstName,
  getAssistantAnimationClass,
  getSleeveStyle,
  isAvatarMessageDismissed,
  normalizeAvatarRole,
  selectAvatarMessage,
  setAvatarMessageDismissed,
} from "./avatar-config";
import type { AvatarActionKey, MiniAvatarAssistantProps } from "./avatar-types";
import { AvatarSpeechBubble } from "./AvatarSpeechBubble";
import { AvatarVisual } from "./AvatarVisual";

type MessageTone = "urgent" | "attention" | "active" | "neutral";

function messageToneFor(messageKey: string): MessageTone {
  if (messageKey === "overdue") return "urgent";
  if (messageKey === "dueToday" || messageKey === "waitingValidation") {
    return "attention";
  }
  if (messageKey === "inProgress" || messageKey === "assigned") return "active";
  return "neutral";
}

function resolvedTimeOfDay(
  enabled: boolean,
  detectedTime: ReturnType<typeof useTimeOfDay>,
) {
  return enabled && detectedTime ? detectedTime : "afternoon";
}

function greetingKeyFor(detectedTime: ReturnType<typeof useTimeOfDay>, timeOfDay: string): string {
  if (!detectedTime) return "greetings.hello";
  return `greetings.${timeOfDay}`;
}

function roleLabelKeyFor(role: string): string {
  if (role === "NEUTRAL") return "neutralAvatar";
  return `${role.toLowerCase()}Avatar`;
}

function surfaceClassFor(variant: string): string {
  if (variant === "embedded") {
    return "mini-avatar-assistant--embedded border-transparent p-0";
  }
  return "border p-3 sm:p-4";
}

function openAvatarClassFor(variant: string): string {
  if (variant === "embedded") {
    return "h-20 w-20 rounded-[24px] sm:h-24 sm:w-24";
  }
  return "h-16 w-16 rounded-[20px] sm:h-20 sm:w-20";
}

function countLabel(count: number): string {
  if (count > 99) return "99+";
  return String(count);
}

export function MiniAvatarAssistant({
  userName,
  role,
  stats,
  status = "ready",
  environmentConfig,
  onAction,
  variant = "card",
  className = "",
}: MiniAvatarAssistantProps) {
  const t = useTranslations("miniAvatar");
  const config = { ...DEFAULT_AVATAR_ENVIRONMENT, ...environmentConfig };
  const detectedTime = useTimeOfDay();
  const detectedSeason = useSeason(config.hemisphere);
  const reducedMotion = usePrefersReducedMotion();
  const [messageOpen, setMessageOpen] = useState(true);

  useEffect(() => {
    setMessageOpen(!isAvatarMessageDismissed(window.sessionStorage));
  }, []);

  const normalizedRole = normalizeAvatarRole(role);
  const timeOfDay = resolvedTimeOfDay(config.enableTimeOfDayAppearance, detectedTime);
  const season = detectedSeason ?? "spring";
  const sleeves = getSleeveStyle(season, config.enableSeasonalClothing && config.clothingMode === "season");
  const animated = Boolean(getAssistantAnimationClass(config.enableAnimations, reducedMotion));
  const selection = useMemo(() => selectAvatarMessage(stats, status), [stats, status]);
  const messageTone = messageToneFor(selection.messageKey);
  const firstName = getAvatarFirstName(userName);
  const greetingKey = greetingKeyFor(detectedTime, timeOfDay);
  const greeting = firstName
    ? t(`${greetingKey}Name`, { name: firstName })
    : t(greetingKey);
  const message = typeof selection.count === "number"
    ? t(`messages.${selection.messageKey}`, { count: selection.count })
    : t(`messages.${selection.messageKey}`);
  const roleLabelKey = roleLabelKeyFor(normalizedRole);

  const closeMessage = () => {
    setAvatarMessageDismissed(window.sessionStorage, true);
    setMessageOpen(false);
  };

  const openMessage = () => {
    setAvatarMessageDismissed(window.sessionStorage, false);
    setMessageOpen(true);
  };

  const action = selection.actionKey && onAction ? (
    <button
      type="button"
      onClick={() => onAction(selection.actionKey as AvatarActionKey)}
      className="group inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-[#075985] px-3.5 py-2 text-xs font-semibold text-white shadow-[0_8px_20px_rgba(7,89,133,0.18)] transition hover:-translate-y-0.5 hover:bg-[#0369a1] hover:shadow-[0_10px_24px_rgba(7,89,133,0.25)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-600 sm:text-sm"
      aria-label={t(`actions.${selection.actionKey}`)}
    >
      {t(`actions.${selection.actionKey}`)}
      <ArrowRightIcon className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5 rtl:rotate-180 rtl:group-hover:-translate-x-0.5" aria-hidden="true" />
    </button>
  ) : null;

  const avatarVisual = (
    <AvatarVisual
      role={normalizedRole}
      timeOfDay={timeOfDay}
      season={season}
      sleeves={sleeves}
      label={t(`accessibility.${roleLabelKey}`)}
      animated={animated}
      neutral={!detectedTime || status !== "ready"}
    />
  );
  const assistantSurfaceClass = surfaceClassFor(variant);
  const openAvatarClass = openAvatarClassFor(variant);

  return (
    <section
      aria-label={t("accessibility.assistantRegion")}
      className={`mini-avatar-assistant relative min-w-0 overflow-hidden rounded-[24px] ${assistantSurfaceClass} ${animated ? "mini-avatar-animate" : ""} ${className}`}
    >
      {messageOpen ? (
        <div className="relative z-10 flex min-w-0 items-center gap-3 sm:gap-4">
          <div className={`mini-avatar-visual relative shrink-0 overflow-hidden border border-white/70 bg-white/60 p-0.5 shadow-[0_14px_32px_rgba(15,23,42,0.16)] ring-1 ring-cyan-700/10 dark:border-white/10 dark:bg-slate-900/50 ${openAvatarClass}`}>
            {avatarVisual}
            <span className="absolute bottom-1.5 start-1.5 inline-flex h-6 w-6 items-center justify-center rounded-lg border border-white/70 bg-white/90 text-cyan-700 shadow-sm backdrop-blur dark:border-white/10 dark:bg-slate-900/90 dark:text-cyan-400" aria-hidden="true">
              <CheckBadgeIcon className="h-4 w-4" />
            </span>
            {typeof selection.count === "number" && selection.count > 0 ? (
              <span className={`avatar-count-badge avatar-count-badge--${messageTone} absolute end-1.5 top-1.5 inline-flex min-w-6 items-center justify-center rounded-lg px-1.5 py-1 text-[10px] font-bold text-white shadow-sm`} aria-hidden="true">
                {countLabel(selection.count)}
              </span>
            ) : null}
          </div>
          <AvatarSpeechBubble
            eyebrow={t("accessibility.assistantRegion")}
            tone={messageTone}
            title={greeting}
            message={message}
            closeLabel={t("actions.closeMessage")}
            onClose={closeMessage}
            action={action}
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={openMessage}
          aria-label={t("actions.openMessage")}
          aria-expanded="false"
          className="group relative z-10 flex min-h-16 w-full min-w-0 items-center gap-3 rounded-[18px] text-start focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cyan-600 sm:gap-4"
        >
          <span className="mini-avatar-visual relative h-14 w-14 shrink-0 overflow-hidden rounded-[17px] border border-white/70 bg-white/60 p-0.5 shadow-[0_8px_22px_rgba(15,23,42,0.1)] ring-1 ring-cyan-700/10 transition-transform group-hover:scale-[1.03] dark:border-white/10 dark:bg-slate-900/50 sm:h-16 sm:w-16">
            {avatarVisual}
          </span>
          <span className="min-w-0 flex-1">
            <span className="mb-0.5 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-700 dark:text-cyan-400">
              <span className="h-1.5 w-1.5 rounded-full bg-cyan-500" aria-hidden="true" />
              {t("accessibility.assistantRegion")}
            </span>
            <span className="block truncate text-sm font-semibold text-text-primary sm:text-base">{greeting}</span>
            <span className="block text-xs text-text-muted">{t("actions.openMessage")}</span>
          </span>
          <span className="me-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border bg-(--surface-elevated) text-cyan-700 shadow-sm transition group-hover:border-cyan-600/30 group-hover:bg-cyan-600 group-hover:text-white dark:text-cyan-400" aria-hidden="true">
            <ArrowRightIcon className="h-4 w-4 rtl:rotate-180" />
          </span>
        </button>
      )}
    </section>
  );
}
