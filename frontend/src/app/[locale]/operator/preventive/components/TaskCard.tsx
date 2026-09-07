import { useTranslations } from "next-intl";

interface TaskCardProps {
  planName: string;
  planCode: string;
  machineName: string;
  machineCode: string;
  checkCount: number;
  completedCount: number;
  dueDate: string | null;
  tab: "today" | "upcoming" | "completed";
  onOpen: () => void;
}

export function TaskCard({ planName, planCode, machineName, machineCode, checkCount, completedCount, dueDate, tab, onOpen }: Readonly<TaskCardProps>) {
  const t = useTranslations("dashboard.operator.preventiveTasksFlow");

  const statusLabelByTab = {
    today: t("statusDueToday"),
    upcoming: t("statusUpcoming"),
    completed: t("statusCompleted"),
  } as const;
  const statusLabel = statusLabelByTab[tab];

  const statusClassByTab = {
    today: "border-amber-200 bg-amber-50 text-amber-800",
    upcoming: "border-blue-200 bg-blue-50 text-blue-800",
    completed: "border-emerald-200 bg-emerald-50 text-emerald-800",
  } as const;
  const statusClass = statusClassByTab[tab];

  return (
    <button
      type="button"
      onClick={onOpen}
      className={`w-full rounded-2xl border p-5 text-left transition hover:-translate-y-1 hover:shadow-lg ${
        tab === "today" ? "border-amber-200 bg-white" : tab === "upcoming" ? "border-slate-200 bg-white" : "border-slate-200 bg-slate-50"
      }`}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="text-base font-semibold text-slate-900">{planName}</div>
          <div className="mt-1 text-sm text-slate-500">
            {machineName} {machineCode && <span className="text-slate-400">{machineCode}</span>}
          </div>
          <div className="mt-2 flex items-center gap-3 text-xs text-slate-500">
            <span>{checkCount} {t("checksLabel")}</span>
            {completedCount > 0 && <span>{completedCount} {t("completedLabel")}</span>}
            {dueDate && <span>{t("due")}: {new Date(dueDate).toLocaleDateString()}</span>}
          </div>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusClass}`}>
          {statusLabel}
        </span>
      </div>
      {tab !== "completed" && (
        <div className="mt-4">
          <span className="inline-flex rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white">
            {t("startChecklist")}
          </span>
        </div>
      )}
      {tab === "completed" && (
        <div className="mt-4">
          <span className="inline-flex rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700">
            {t("viewResults")}
          </span>
        </div>
      )}
    </button>
  );
}
