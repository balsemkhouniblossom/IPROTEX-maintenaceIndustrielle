import { useTranslations } from "next-intl";
import { Machine, MachineType } from "../types.ts";

export function PreventiveMachineSelector({
  visibleMachineTypes,
  selectedCategory,
  onSelectCategory,
  machinesForCategory,
  selectedMachine,
  onSelectMachine,
  t,
  tCommon,
}: Readonly<{
  visibleMachineTypes: MachineType[];
  selectedCategory: string;
  onSelectCategory: (machineTypeId: string) => void;
  machinesForCategory: Machine[];
  selectedMachine: string;
  onSelectMachine: (machineId: string) => void;
  t: ReturnType<typeof useTranslations>;
  tCommon: ReturnType<typeof useTranslations>;
}>) {
  return (
    <>
      <div className="mb-6">
        <div className="mb-3 text-sm font-semibold text-slate-700">{t("machineCategory")}</div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {visibleMachineTypes.map((item) => (
            <button
              key={item._id}
              type="button"
              onClick={() => onSelectCategory(item._id)}
              data-testid="preventive-category-select"
              className={`rounded-3xl border p-4 text-left transition hover:-translate-y-1 hover:shadow-lg ${
                selectedCategory === item._id ? "border-blue-500 bg-blue-50 shadow-md" : "border-slate-200 bg-white"
              }`}
            >
              <div className="text-lg font-semibold text-slate-900">{item.name}</div>
              <div className="mt-1 text-xs uppercase tracking-wide text-slate-500">{t("viewMachines")}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="mb-6">
        <div className="mb-3 text-sm font-semibold text-slate-700">{t("machine")}</div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {machinesForCategory.map((machine) => (
            <button
              key={machine._id}
              type="button"
              onClick={() => onSelectMachine(machine._id)}
              data-testid="preventive-machine-select"
              className={`rounded-3xl border p-4 text-left transition hover:-translate-y-1 hover:shadow-lg ${
                selectedMachine === machine._id ? "border-emerald-500 bg-emerald-50 shadow-md" : "border-slate-200 bg-white"
              }`}
            >
              <div className="text-base font-semibold text-slate-900">{machine.machine_id}</div>
              <div className="mt-1 text-sm text-slate-500">{machine.model || tCommon("notAvailable")}</div>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
