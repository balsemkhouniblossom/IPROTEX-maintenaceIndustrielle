type PlanRef =
  | string
  | { _id?: string; maintenance_code?: string; plan_id?: string }
  | null
  | undefined;

export interface PreventiveChecklistSearchable {
  instruction?: string;
  task_id?: string;
  responsable?: string;
  plan_id?: PlanRef;
}

function planLabel(plan: PlanRef): string {
  if (!plan || typeof plan === "string") return "";
  return plan.maintenance_code || plan.plan_id || "";
}

export function matchesPreventiveChecklistSearch(
  item: PreventiveChecklistSearchable,
  term: string,
): boolean {
  const normalized = term.trim().toLowerCase();
  if (!normalized) return true;

  const haystack = [item.instruction, item.task_id, item.responsable, planLabel(item.plan_id)]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return haystack.includes(normalized);
}
