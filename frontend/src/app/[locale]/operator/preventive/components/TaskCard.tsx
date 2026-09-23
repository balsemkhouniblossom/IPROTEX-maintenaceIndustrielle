import { useLocale, useTranslations } from "next-intl";

interface TaskCardProps {
  planName: string;
  machineName: string;
  machineCode: string;
  checkCount: number;
  completedCount: number;
  dueDate: string | null;
  tab: "today" | "upcoming" | "completed";
  onOpen: () => void;
}

export function TaskCard({ planName, machineName, machineCode, checkCount, completedCount, dueDate, tab, onOpen }: Readonly<TaskCardProps>) {
  const t = useTranslations("dashboard.operator.preventiveTasksFlow");
  const locale = useLocale();
  const due = dueDate ? new Date(dueDate) : null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const isOverdue = tab === "today" && Boolean(due && due.getTime() < today.getTime());

  const statusLabelByTab = {
    today: t("statusDueToday"),
    upcoming: t("statusUpcoming"),
    completed: t("statusCompleted"),
  } as const;
  const statusLabel = isOverdue ? t("statusOverdue") : statusLabelByTab[tab];

  const statusClassByTab = {
    today: "border-amber-200 bg-amber-50 text-amber-800",
    upcoming: "border-blue-200 bg-blue-50 text-blue-800",
    completed: "border-emerald-200 bg-emerald-50 text-emerald-800",
  } as const;
  const statusClass = isOverdue
    ? "border-rose-200 bg-rose-50 text-rose-800"
    : statusClassByTab[tab];
  const cardClassByTab = {
    today: "border-amber-200 bg-white",
    upcoming: "border-slate-200 bg-white",
    completed: "border-slate-200 bg-slate-50",
  } as const;
  const cardClass = cardClassByTab[tab];
  const formattedDueDate = due
    ? new Intl.DateTimeFormat(locale).format(due)
    : null;
  const showMachineCode = Boolean(
    machineCode && machineCode.trim() !== machineName.trim(),
  );

  return (
    <button
      type="button"
      onClick={onOpen}
      className={`group flex h-full min-w-0 flex-col rounded-2xl border p-5 text-start shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 sm:p-6 ${cardClass}`}
    >
      <div className="flex flex-col items-start gap-3 sm:flex-row sm:justify-between sm:gap-4">
        <div className="min-w-0 w-full flex-1">
          <div dir="auto" className="line-clamp-3 text-base font-semibold leading-6 text-slate-900 sm:text-lg">
            {planName}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-500">
            <bdi dir="auto" className="font-medium text-slate-700">{machineName}</bdi>
            {showMachineCode && <bdi dir="ltr" className="text-slate-400">{machineCode}</bdi>}
          </div>
        </div>
        <span className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold ${statusClass}`}>
          {statusLabel}
        </span>
      </div>

      <div className="mt-5 flex flex-wrap gap-x-4 gap-y-2 border-t border-slate-200 pt-4 text-xs text-slate-500">
        <span>{checkCount} {t("checksLabel")}</span>
        {completedCount > 0 && <span>{completedCount} {t("completedLabel")}</span>}
        {formattedDueDate && <span>{t("due")}: <bdi dir="ltr">{formattedDueDate}</bdi></span>}
      </div>

      <div className="mt-auto pt-5">
        <span
          className={`inline-flex rounded-xl px-4 py-2 text-sm font-semibold transition-colors ${
            tab === "completed"
              ? "border border-slate-300 bg-white text-slate-700 group-hover:bg-slate-100"
              : "bg-slate-900 text-white group-hover:bg-slate-800"
          }`}
        >
          {tab === "completed" ? t("viewResults") : t("startChecklist")}
        </span>
      </div>
    </button>
  );
}
