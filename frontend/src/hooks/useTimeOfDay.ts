"use client";

import { useEffect, useState } from "react";
import {
  getMillisecondsUntilNextTimePeriod,
  getSeason,
  getTimeOfDay,
} from "@/components/avatar/avatar-config";
import type { AvatarHemisphere, Season, TimeOfDay } from "@/components/avatar/avatar-types";

export function useTimeOfDay(): TimeOfDay | null {
  const [timeOfDay, setTimeOfDay] = useState<TimeOfDay | null>(null);

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>;

    const update = () => {
      const now = new Date();
      setTimeOfDay((current) => {
        const next = getTimeOfDay(now);
        return current === next ? current : next;
      });
      timeoutId = setTimeout(update, getMillisecondsUntilNextTimePeriod(now) + 50);
    };

    update();
    return () => clearTimeout(timeoutId);
  }, []);

  return timeOfDay;
}

export function useSeason(hemisphere: AvatarHemisphere): Season | null {
  const [season, setSeason] = useState<Season | null>(null);

  useEffect(() => {
    setSeason(getSeason(new Date(), hemisphere));
  }, [hemisphere]);

  return season;
}

export function usePrefersReducedMotion(): boolean {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return reducedMotion;
}
