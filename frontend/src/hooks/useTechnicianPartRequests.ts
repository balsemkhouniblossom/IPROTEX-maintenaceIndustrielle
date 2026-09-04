"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { PartRequestRecord, PartRequestStatusValue } from "@/components/technician/partsWorkspaceTypes";
import { asPartRequestRecord, isPartRequestStatus } from "@/components/technician/partsPresentation";

const STORAGE_PREFIX = "technician.partRequests.";

function readStored(workOrderId: string): PartRequestRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${workOrderId}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(asPartRequestRecord)
      .filter((record): record is PartRequestRecord => record !== null);
  } catch {
    return [];
  }
}

function writeStored(workOrderId: string, records: PartRequestRecord[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      `${STORAGE_PREFIX}${workOrderId}`,
      JSON.stringify(records),
    );
  } catch {
    // ignore quota failures
  }
}

export function useTechnicianPartRequests(workOrderId: string | undefined) {
  const [records, setRecords] = useState<PartRequestRecord[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (!workOrderId) {
      setRecords([]);
      setHydrated(true);
      return;
    }
    setRecords(readStored(workOrderId));
    setHydrated(true);
  }, [workOrderId]);

  const update = useCallback(
    (next: PartRequestRecord[] | ((prev: PartRequestRecord[]) => PartRequestRecord[])) => {
      setRecords((prev) => {
        const value = typeof next === "function" ? next(prev) : next;
        if (workOrderId) writeStored(workOrderId, value);
        return value;
      });
    },
    [workOrderId],
  );

  const addOrUpdate = useCallback(
    (incoming: PartRequestRecord) => {
      update((prev) => {
        const existingIndex = prev.findIndex((entry) => entry._id === incoming._id);
        if (existingIndex === -1) {
          return [...prev, incoming];
        }
        const copy = [...prev];
        copy[existingIndex] = { ...copy[existingIndex], ...incoming };
        return copy;
      });
    },
    [update],
  );

  const updateStatus = useCallback(
    (id: string, status: PartRequestStatusValue) => {
      if (!isPartRequestStatus(status)) return;
      update((prev) =>
        prev.map((entry) => (entry._id === id ? { ...entry, status } : entry)),
      );
    },
    [update],
  );

  const remove = useCallback(
    (id: string) => {
      update((prev) => prev.filter((entry) => entry._id !== id));
    },
    [update],
  );

  return useMemo(
    () => ({ records, hydrated, addOrUpdate, updateStatus, remove }),
    [records, hydrated, addOrUpdate, updateStatus, remove],
  );
}
