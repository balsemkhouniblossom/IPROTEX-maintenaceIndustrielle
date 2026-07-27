/** Builds a Mongo range filter for a single date field — `undefined` when neither bound is given, so callers can safely spread `{ ...maybeFilter }` into a larger query without adding an empty-object noise key. */
export function buildDateRangeFilter(
  dateFrom?: Date,
  dateTo?: Date,
): { $gte?: Date; $lt?: Date } | undefined {
  if (!dateFrom && !dateTo) return undefined;
  return {
    ...(dateFrom ? { $gte: dateFrom } : {}),
    ...(dateTo ? { $lt: dateTo } : {}),
  };
}
