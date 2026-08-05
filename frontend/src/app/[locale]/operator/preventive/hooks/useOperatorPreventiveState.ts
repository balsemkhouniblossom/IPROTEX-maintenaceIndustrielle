import { useCallback, useEffect, useRef, useState } from "react";
import { apiService } from "@/services/api";
import { PreventiveStateResponse } from "../types.ts";

/**
 * Owns the single `getOperatorPreventiveStates` fetch for the selected
 * machine. `refreshPreventiveState()` is the one place that ever calls the
 * endpoint — every mutation (start task, submit) calls it instead of
 * duplicating the fetch, so there is exactly one code path to keep in sync
 * with the backend response shape.
 *
 * A monotonically increasing request sequence discards any response that
 * resolves after a newer request has already started (e.g. the operator
 * switches machines while a request for the previous machine is in flight).
 */
export function useOperatorPreventiveState(selectedMachine: string) {
  const [preventiveState, setPreventiveState] = useState<PreventiveStateResponse | null>(null);
  const [stateLoading, setStateLoading] = useState(false);
  const requestSequence = useRef(0);

  const refreshPreventiveState = useCallback(async (machineId: string): Promise<void> => {
    if (!machineId) {
      requestSequence.current += 1;
      setPreventiveState(null);
      return;
    }

    const sequence = requestSequence.current + 1;
    requestSequence.current = sequence;

    try {
      setStateLoading(true);
      const response = await apiService.getOperatorPreventiveStates({ machineId });
      if (requestSequence.current !== sequence) return;
      setPreventiveState((response.data || null) as PreventiveStateResponse | null);
    } catch (error) {
      console.error("Failed to load machine preventive scheduling state", error);
      if (requestSequence.current === sequence) setPreventiveState(null);
    } finally {
      if (requestSequence.current === sequence) setStateLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshPreventiveState(selectedMachine);
  }, [selectedMachine, refreshPreventiveState]);

  const refresh = useCallback(() => refreshPreventiveState(selectedMachine), [refreshPreventiveState, selectedMachine]);

  const clearPreventiveState = useCallback(() => {
    requestSequence.current += 1;
    setPreventiveState(null);
  }, []);

  return { preventiveState, stateLoading, refreshPreventiveState: refresh, clearPreventiveState };
}
