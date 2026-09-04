export type TechnicianDocument = {
  _id?: string;
  document_id?: string;
  machine_id: DocumentMachineRef;
  maintenance_plan_id?: string;
  work_order_id?: string;
  intervention_report_id?: string;
  type_document?: string;
  file_path?: string;
  storage_path?: string;
  file_url?: string;
  file_name?: string;
  preview_path?: string;
  description?: string;
  tags?: string[];
  uploaded_by?: string;
  date_ajout?: string;
  status?: string;
  version?: number;
  revision?: number;
  root_document_id?: string;
  supersedes_document_id?: string;
  superseded_by_document_id?: string;
  lifecycle_history?: unknown[];
};

type DocumentMachineRef =
  | string
  | { _id?: string; machine_id?: string; reference?: string; model?: string; serial_no?: string }
  | null
  | undefined;

export function documentMachineLabel(
  machine: DocumentMachineRef,
  fallback: string,
): string {
  if (!machine) return fallback;
  if (typeof machine === "string") return machine || fallback;
  return (
    machine.machine_id ||
    machine.reference ||
    machine.serial_no ||
    machine.model ||
    fallback
  );
}

export function documentTypeLabel(type?: string, fallback = "—"): string {
  if (!type) return fallback;
  return type
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function documentDateLabel(
  value: string | Date | undefined,
  locale: string,
  fallback: string,
): string {
  if (!value) return fallback;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toLocaleDateString(locale, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function documentStatusLabel(status: string | undefined, fallback: string): string {
  if (!status) return fallback;
  return status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();
}

export function documentStatusTone(
  status: string | undefined,
): { bg: string; text: string; border: string } {
  const value = (status || "").toLowerCase();
  if (value === "published") {
    return {
      bg: "bg-emerald-50",
      text: "text-emerald-700",
      border: "border-emerald-200",
    };
  }
  if (value === "archived") {
    return {
      bg: "bg-slate-100",
      text: "text-slate-600",
      border: "border-slate-300",
    };
  }
  if (value === "draft") {
    return {
      bg: "bg-amber-50",
      text: "text-amber-700",
      border: "border-amber-200",
    };
  }
  return {
    bg: "bg-slate-50",
    text: "text-slate-700",
    border: "border-slate-200",
  };
}

export function searchDocuments(
  documents: TechnicianDocument[],
  term: string,
  fallback: string,
): TechnicianDocument[] {
  const query = term.trim().toLowerCase();
  if (!query) return documents;
  return documents.filter((document) => {
    const haystack = [
      document.file_name,
      document.description,
      documentTypeLabel(document.type_document),
      documentMachineLabel(document.machine_id, fallback),
      document.document_id,
      ...(document.tags || []),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(query);
  });
}

export function filterDocumentsByType(
  documents: TechnicianDocument[],
  type: string,
): TechnicianDocument[] {
  if (!type) return documents;
  const normalized = type.toLowerCase();
  return documents.filter(
    (document) => (document.type_document || "").toLowerCase() === normalized,
  );
}

export function filterDocumentsByMachine(
  documents: TechnicianDocument[],
  machineId: string,
): TechnicianDocument[] {
  if (!machineId) return documents;
  return documents.filter((document) => {
    const machine = document.machine_id;
    if (!machine) return false;
    if (typeof machine === "string") return machine === machineId;
    return machine._id === machineId || machine.machine_id === machineId;
  });
}

export function uniqueDocumentTypes(documents: TechnicianDocument[]): string[] {
  const seen = new Set<string>();
  for (const document of documents) {
    if (document.type_document) seen.add(document.type_document);
  }
  return [...seen].sort((left, right) => left.localeCompare(right));
}

export function uniqueDocumentMachines(
  documents: TechnicianDocument[],
  fallback: string,
): Array<{ id: string; label: string }> {
  const map = new Map<string, string>();
  for (const document of documents) {
    const machine = document.machine_id;
    if (!machine) continue;
    if (typeof machine === "string") {
      if (!map.has(machine)) map.set(machine, machine);
      continue;
    }
    const id = machine._id || machine.machine_id;
    if (!id || map.has(id)) continue;
    map.set(id, documentMachineLabel(machine, fallback));
  }
  return [...map.entries()]
    .map(([id, label]) => ({ id, label }))
    .sort((left, right) => left.label.localeCompare(right.label));
}
