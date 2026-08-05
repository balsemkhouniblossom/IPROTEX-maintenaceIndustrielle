import { useEffect, useState } from "react";
import { apiService } from "@/services/api";
import { fetchAllPaginated } from "@/services/pagination";
import {
  DocumentEntity,
  Kpi,
  Lubrifiant,
  Machine,
  MaintenancePlan,
  MachineType,
  ModuleEntity,
} from "../types.ts";

export type OperatorPreventiveBootstrapData = {
  machineTypes: MachineType[];
  machines: Machine[];
  modules: ModuleEntity[];
  plans: MaintenancePlan[];
  documents: DocumentEntity[];
  lubrifiants: Lubrifiant[];
  kpis: Kpi[];
};

function emptyBootstrapData(): OperatorPreventiveBootstrapData {
  return {
    machineTypes: [],
    machines: [],
    modules: [],
    plans: [],
    documents: [],
    lubrifiants: [],
    kpis: [],
  };
}

/**
 * Loads the seven reference-data collections the preventive workflow needs,
 * as one parallel batch, exactly once per mount. A failure in any single
 * request aborts the whole batch (matching the original behavior: none of
 * the seven setters ran unless every request resolved).
 */
export function useOperatorPreventiveBootstrap() {
  const [data, setData] = useState<OperatorPreventiveBootstrapData>(emptyBootstrapData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadAll() {
      try {
        setLoading(true);
        setError(null);
        const [machineTypes, machines, modules, plans, documents, lubrifiants, kpis] = await Promise.all([
          fetchAllPaginated<MachineType>((params) => apiService.getOperatorMachineTypes(params)),
          fetchAllPaginated<Machine>((params) => apiService.getMyMachines(params)),
          fetchAllPaginated<ModuleEntity>((params) => apiService.getOperatorModules(params)),
          fetchAllPaginated<MaintenancePlan>((params) => apiService.getOperatorMaintenancePlans(params)),
          fetchAllPaginated<DocumentEntity>((params) => apiService.getOperatorManuals(params)),
          fetchAllPaginated<Lubrifiant>((params) => apiService.getOperatorLubrifiants(params)),
          fetchAllPaginated<Kpi>((params) => apiService.getOperatorKpis(params)),
        ]);

        if (cancelled) return;
        setData({ machineTypes, machines, modules, plans, documents, lubrifiants, kpis });
      } catch (loadError) {
        console.error("Failed to load preventive workflow data", loadError);
        if (!cancelled) setError(loadError);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadAll();

    return () => {
      cancelled = true;
    };
  }, []);

  return { ...data, loading, error };
}
