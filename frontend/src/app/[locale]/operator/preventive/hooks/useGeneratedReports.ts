import { useEffect, useRef, useState } from "react";
import { GeneratedReportRow, REPORTS_STORAGE_KEY } from "../types.ts";

const MAX_REPORTS = 30;

function loadPersistedReports(): GeneratedReportRow[] {
  if (typeof window === "undefined") return [];
  try {
    const saved = localStorage.getItem(REPORTS_STORAGE_KEY);
    if (!saved) return [];
    const parsed = JSON.parse(saved) as GeneratedReportRow[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistReports(reports: GeneratedReportRow[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(REPORTS_STORAGE_KEY, JSON.stringify(reports));
}

/**
 * Loads the operator's locally-cached report history once on mount, then
 * persists it explicitly whenever it changes afterward. Persistence is a
 * plain effect rather than a side effect buried in the `setState` updater,
 * so it's obvious when a write happens and the just-loaded value is never
 * echoed straight back to storage on the first render.
 */
export function useGeneratedReports() {
  const [generatedReports, setGeneratedReports] = useState<GeneratedReportRow[]>([]);
  const hydrated = useRef(false);

  useEffect(() => {
    setGeneratedReports(loadPersistedReports());
    hydrated.current = true;
  }, []);

  useEffect(() => {
    if (!hydrated.current) return;
    persistReports(generatedReports);
  }, [generatedReports]);

  function addGeneratedReport(report: GeneratedReportRow): void {
    setGeneratedReports((prev) => [report, ...prev].slice(0, MAX_REPORTS));
  }

  return { generatedReports, addGeneratedReport };
}
