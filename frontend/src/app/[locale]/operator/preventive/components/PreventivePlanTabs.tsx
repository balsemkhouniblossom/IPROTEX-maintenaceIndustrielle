import { PreventivePlanGroup } from "../types.ts";

export function PreventivePlanTabs({
  groups,
  selectedPlanIdsSet,
  onSelectGroup,
  formatPlanStateLabel,
}: {
  groups: PreventivePlanGroup[];
  selectedPlanIdsSet: Set<string>;
  onSelectGroup: (planIds: string[]) => void;
  formatPlanStateLabel: (state: string) => string;
}) {
  return (
    <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
      {groups.map((group) => (
        <button
          key={group.key}
          type="button"
          onClick={() => onSelectGroup(group.planIds)}
          className={`shrink-0 rounded-lg border px-4 py-2 text-left text-sm ${
            group.planIds.some((planId) => selectedPlanIdsSet.has(planId))
              ? "border-emerald-500 bg-emerald-50 text-emerald-800"
              : "border-slate-200 bg-white text-slate-700"
          }`}
        >
          <div className="font-semibold">{group.label}</div>
          <div className="text-xs">
            {formatPlanStateLabel(group.states[0].currentState)}
            {group.states.length > 1 ? ` (${group.states.length})` : ""}
          </div>
        </button>
      ))}
    </div>
  );
}
