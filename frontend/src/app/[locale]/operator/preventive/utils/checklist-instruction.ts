export interface ChecklistInstructionDisplay {
  code: string | null;
  details: string;
}

const W_CODE_PREFIX = /^(W\d+(?:\s*,\s*W\d+)*)\s*:\s*([\s\S]+)$/i;

export function parseChecklistInstruction(
  instruction: string,
): ChecklistInstructionDisplay {
  const normalized = instruction.trim();
  const match = W_CODE_PREFIX.exec(normalized);
  if (!match) {
    return { code: null, details: normalized };
  }

  return {
    code: match[1].replace(/\s+/g, ""),
    details: match[2].trim(),
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
