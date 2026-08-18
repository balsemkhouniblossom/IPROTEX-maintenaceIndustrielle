"use client";

import { useId } from "react";
import { ROLE_CONFIG } from "./avatar-config";
import type { AvatarRole, Season, SleeveStyle, TimeOfDay } from "./avatar-types";

interface AvatarVisualProps {
  role: AvatarRole | "NEUTRAL";
  timeOfDay: TimeOfDay;
  season: Season;
  sleeves: SleeveStyle;
  label: string;
  animated: boolean;
  neutral?: boolean;
}

const TIME_COLORS: Record<TimeOfDay, { background: string; accent: string }> = {
  morning: { background: "#dff4ff", accent: "#fbbf24" },
  afternoon: { background: "#e0f2fe", accent: "#38bdf8" },
  evening: { background: "#e6efff", accent: "#f59e0b" },
  night: { background: "#172554", accent: "#dbeafe" },
};

type RoleVisualConfig = (typeof ROLE_CONFIG)[AvatarRole | "NEUTRAL"];
type TimeColors = { background: string; accent: string };

export function AvatarVisual({ role, timeOfDay, sleeves, label, animated, neutral = false }: AvatarVisualProps) {
  const titleId = useId();
  const uniformGradientId = useId();
  const skinGradientId = useId();
  const backgroundGradientId = useId();
  const roleConfig = ROLE_CONFIG[role];
  const colors = neutral ? { background: "#e2e8f0", accent: "#94a3b8" } : TIME_COLORS[timeOfDay];
  const hasLongSleeves = sleeves !== "short";
  const hasJacket = sleeves === "jacket";

  return (
    <svg
      viewBox="0 0 120 120"
      role="img"
      aria-labelledby={titleId}
      className={`h-full w-full ${animated ? "mini-avatar-body" : ""}`}
    >
      <title id={titleId}>{label}</title>
      <defs>
        <linearGradient id={uniformGradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={roleConfig.uniform} />
          <stop offset="1" stopColor={roleConfig.uniformDark} />
        </linearGradient>
        <linearGradient id={skinGradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#d6a47b" />
          <stop offset="1" stopColor="#b97950" />
        </linearGradient>
        <linearGradient id={backgroundGradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={colors.background} />
          <stop offset="1" stopColor={timeOfDay === "night" ? "#0f172a" : "#f8fafc"} />
        </linearGradient>
      </defs>

      <rect x="3" y="3" width="114" height="114" rx="30" fill={`url(#${backgroundGradientId})`} />
      <g aria-hidden="true" opacity={timeOfDay === "night" ? 0.16 : 0.24}>
        <path d="M8 89h104M8 100h104M24 6v108M96 6v108" fill="none" stroke={colors.accent} strokeWidth=".7" />
        <path d="M9 76c20-8 37-9 52-4 18 6 34 4 50-5" fill="none" stroke={colors.accent} strokeWidth="1" strokeDasharray="3 4" />
      </g>
      <TimeDecoration timeOfDay={timeOfDay} neutral={neutral} colors={colors} />

      <path d="M22 112c2-24 16-37 38-37s36 13 38 37" fill={`url(#${uniformGradientId})`} />
      <path d="M40 83c11 8 29 8 40 0" fill="none" stroke="#fff" strokeWidth="1.5" opacity=".24" />
      <Sleeves hasLongSleeves={hasLongSleeves} hasJacket={hasJacket} roleConfig={roleConfig} />
      {hasJacket ? <path d="M60 79v33M51 80l9 10 9-10" fill="none" stroke="#bfdbfe" strokeWidth="2" opacity=".9" /> : null}
      <path d="M50 69h20v17c-5 5-15 5-20 0V69Z" fill={`url(#${skinGradientId})`} />
      <ellipse cx="60" cy="51" rx="23" ry="27" fill={`url(#${skinGradientId})`} />
      <path d="M39 49c0-18 8-27 21-27 14 0 22 9 22 27-5-9-13-13-22-13-8 0-15 4-21 13Z" fill="#26384b" />

      <Headwear helmet={roleConfig.helmet} />

      <g className={animated ? "mini-avatar-eyes" : ""} aria-hidden="true">
        <ellipse cx="51" cy="52" rx="2" ry="2.2" fill="#172033" />
        <ellipse cx="69" cy="52" rx="2" ry="2.2" fill="#172033" />
      </g>
      <path d="M54 63c4 3 8 3 12 0" fill="none" stroke="#7c3f2a" strokeWidth="1.8" strokeLinecap="round" />

      <g aria-hidden="true">
        <circle cx="78" cy="88" r="10" fill="#f8fafc" stroke="#cbd5e1" strokeWidth="1.5" />
        <RoleTool role={role} uniform={roleConfig.uniform} />
      </g>
      {animated ? <path className="mini-avatar-wave" d="M91 69c3-3 5-6 5-9" fill="none" stroke={colors.accent} strokeWidth="2" strokeLinecap="round" aria-hidden="true" /> : null}
    </svg>
  );
}

function TimeDecoration({
  timeOfDay,
  neutral,
  colors,
}: {
  timeOfDay: TimeOfDay;
  neutral: boolean;
  colors: TimeColors;
}) {
  if (timeOfDay === "night" && !neutral) {
    return (
      <g aria-hidden="true">
        <circle cx="88" cy="25" r="10" fill={colors.accent} />
        <circle cx="93" cy="21" r="10" fill={colors.background} />
        <circle cx="28" cy="29" r="1.5" fill="#fff" />
        <circle cx="98" cy="47" r="1" fill="#fff" />
      </g>
    );
  }

  return (
    <g aria-hidden="true" opacity={timeOfDay === "afternoon" ? 0.55 : 0.85}>
      <circle cx="91" cy="27" r={timeOfDay === "evening" ? 9 : 11} fill={colors.accent} />
      {timeOfDay === "morning" ? <path d="M91 8v8M72 27h8M102 27h9M78 14l6 6M104 14l-6 6" stroke={colors.accent} strokeWidth="2" strokeLinecap="round" /> : null}
    </g>
  );
}

function Sleeves({
  hasLongSleeves,
  hasJacket,
  roleConfig,
}: {
  hasLongSleeves: boolean;
  hasJacket: boolean;
  roleConfig: RoleVisualConfig;
}) {
  if (hasLongSleeves) {
    return (
      <path d="M22 112c1-18 7-29 19-34l8 9-8 25H22Zm76 0c-1-18-7-29-19-34l-8 9 8 25h19Z" fill={hasJacket ? roleConfig.uniformDark : roleConfig.uniform} />
    );
  }

  return <path d="M23 112c1-15 6-25 16-31l9 10-5 21H23Zm74 0c-1-15-6-25-16-31L72 91l5 21h20Z" fill={roleConfig.uniform} />;
}

function Headwear({ helmet }: { helmet: boolean }) {
  if (!helmet) {
    return <path d="M37 42c2-18 10-28 23-28 14 0 23 10 24 29-7-8-15-12-24-12-8 0-16 4-23 11Z" fill="#26384b" />;
  }

  return (
    <g aria-hidden="true">
      <path d="M36 39c1-17 10-27 24-27 15 0 24 10 25 27H36Z" fill="#f8fafc" stroke="#94a3b8" strokeWidth="1.5" />
      <path d="M43 39c1-13 6-21 17-22v22H43Z" fill="#f59e0b" opacity=".9" />
      <path d="M31 39h58c0 4-4 7-9 7H40c-5 0-9-3-9-7Z" fill="#f8fafc" stroke="#64748b" strokeWidth="1.5" />
      <path d="M42 35h37" stroke="#fff" strokeWidth="2" strokeLinecap="round" opacity=".75" />
    </g>
  );
}

function RoleTool({ role, uniform }: { role: AvatarRole | "NEUTRAL"; uniform: string }) {
  if (role === "TECHNICIAN") {
    return <path d="M73 83l10 10M80 82a4 4 0 0 0 4 5l-5-5a4 4 0 0 0-5 4l5 5" fill="none" stroke="#c2410c" strokeWidth="1.8" strokeLinecap="round" />;
  }

  return <path d="M74 88h8M78 84v8" stroke={uniform} strokeWidth="2" strokeLinecap="round" />;
}
