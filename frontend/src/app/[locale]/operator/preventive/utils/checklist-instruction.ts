export interface ChecklistInstructionDisplay {
  code: string | null;
  details: string;
}

export function parseChecklistInstruction(
  instruction: string,
): ChecklistInstructionDisplay {
  const normalized = instruction.trim();
  const separatorIndex = normalized.indexOf(":");
  if (separatorIndex < 0) {
    return { code: null, details: normalized };
  }

  const rawCode = normalized.slice(0, separatorIndex).trim();
  const details = normalized.slice(separatorIndex + 1).trim();
  const codes = rawCode.split(",").map((code) => code.trim());
  if (!details || !codes.length || codes.some((code) => !/^W\d+$/i.test(code))) {
    return { code: null, details: normalized };
  }

  return {
    code: codes.join(","),
    details,
  };
}

export function sortChecklistItems<
  T extends { instruction: string; task_id?: string },
>(items: T[]): T[] {
  return items
    .map((item, originalIndex) => ({ item, originalIndex }))
    .sort((left, right) => {
      const leftCode = parseChecklistInstruction(left.item.instruction).code;
      const rightCode = parseChecklistInstruction(right.item.instruction).code;
      const leftNumber = Number(
        /^W(\d+)/i.exec(leftCode || "")?.[1] ?? Infinity,
      );
      const rightNumber = Number(
        /^W(\d+)/i.exec(rightCode || "")?.[1] ?? Infinity,
      );
      if (leftNumber !== rightNumber) return leftNumber - rightNumber;

      const taskOrder = (left.item.task_id || "").localeCompare(
        right.item.task_id || "",
        undefined,
        { numeric: true, sensitivity: "base" },
      );
      return taskOrder || left.originalIndex - right.originalIndex;
    })
    .map(({ item }) => item);
}
