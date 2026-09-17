export type HistoricalMttrContext = {
  process: string;
  month: number;
  defectCount: number;
  defectCodes: string[];
};

export function parseManualMttrMinutes(
  value: string,
): number | null | undefined {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const numericValue = Number(trimmed);
  return Number.isFinite(numericValue) && numericValue >= 0
    ? numericValue
    : undefined;
}

export function averageSavedValues(
  values: Array<number | null>,
): number | null {
  const saved = values.filter((value): value is number => value !== null);
  if (saved.length === 0) return null;
  return saved.reduce((sum, value) => sum + value, 0) / saved.length;
}

export function buildHistoricalMatrix(rows: HistoricalMttrContext[]) {
  const processNames = [...new Set(rows.map((row) => row.process))].sort();
  const processes = processNames.map((process) => {
    const months = Array.from({ length: 12 }, (_, index) => {
      const monthRows = rows.filter(
        (row) => row.process === process && row.month === index + 1,
      );
      return {
        month: index + 1,
        defectCount: monthRows.reduce((sum, row) => sum + row.defectCount, 0),
        defectCodes: [
          ...new Set(monthRows.flatMap((row) => row.defectCodes)),
        ].sort(),
      };
    });
    return {
      process,
      months,
      total: months.reduce((sum, month) => sum + month.defectCount, 0),
    };
  });
  const monthlyTotals = Array.from({ length: 12 }, (_, index) =>
    processes.reduce(
      (sum, process) => sum + process.months[index].defectCount,
      0,
    ),
  );
  return {
    processes,
    monthlyTotals,
    finalTotal: monthlyTotals.reduce((sum, count) => sum + count, 0),
  };
}
