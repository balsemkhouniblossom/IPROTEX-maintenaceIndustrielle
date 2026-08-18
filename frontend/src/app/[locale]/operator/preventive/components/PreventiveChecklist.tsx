import { useTranslations } from "next-intl";
import { PreventiveTaskChecklistItem } from "../types.ts";

export function PreventiveChecklist({
  checklistLoading,
  stateLoading,
  checklistError,
  items,
  checklistNotesDraft,
  checklistSavingId,
  taskStarted,
  onToggleItem,
  onNoteChange,
  onNoteBlur,
  tCommon,
  tChecklist,
}: Readonly<{
  checklistLoading: boolean;
  stateLoading: boolean;
  checklistError: string;
  items: PreventiveTaskChecklistItem[];
  checklistNotesDraft: Record<string, string>;
  checklistSavingId: string;
  taskStarted: boolean;
  onToggleItem: (item: PreventiveTaskChecklistItem) => void;
  onNoteChange: (itemId: string, value: string) => void;
  onNoteBlur: (item: PreventiveTaskChecklistItem) => void;
  tCommon: ReturnType<typeof useTranslations>;
  tChecklist: ReturnType<typeof useTranslations>;
}>) {
  return (
    <div className="mt-4 max-h-[360px] space-y-2 overflow-y-auto pr-1">
      {checklistLoading || stateLoading ? (
        <div data-testid="preventive-checklist-loading" className="text-sm text-slate-500">
          {tCommon("loading")}
        </div>
      ) : checklistError ? (
        <div data-testid="preventive-checklist-error" className="text-sm text-red-600">
          {checklistError}
        </div>
      ) : items.length === 0 ? (
        <div data-testid="preventive-checklist-empty" className="text-sm text-slate-500">
          {tChecklist("empty.default")}
        </div>
      ) : (
        items.map((item, index) => (
          <div
            key={item._id}
            data-testid={`preventive-checklist-item-${index}`}
            className={`rounded-xl border p-3 ${
              item.status === "completed" ? "border-emerald-400 bg-emerald-50" : "border-slate-200 bg-white"
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="text-sm font-medium text-slate-900">{item.instruction}</div>
              <button
                type="button"
                disabled={checklistSavingId === item._id || !taskStarted}
                onClick={() => onToggleItem(item)}
                data-testid={`preventive-checklist-toggle-${index}`}
                className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50 ${
                  item.status === "completed" ? "bg-slate-600" : "bg-emerald-600"
                }`}
              >
                {item.status === "completed" ? tChecklist("status.pending") : tChecklist("actions.complete")}
              </button>
            </div>
            <input
              value={checklistNotesDraft[item._id] ?? item.notes ?? ""}
              onChange={(event) => onNoteChange(item._id, event.target.value)}
              onBlur={() => onNoteBlur(item)}
              data-testid={`preventive-checklist-notes-${index}`}
              className="mt-2 w-full rounded-lg border px-3 py-2 text-sm"
              placeholder={tChecklist("placeholders.notes")}
            />
          </div>
        ))
      )}
    </div>
  );
}
