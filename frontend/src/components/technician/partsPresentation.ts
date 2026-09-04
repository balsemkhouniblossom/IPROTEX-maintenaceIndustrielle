import type {
  AvailabilityState,
  PartRequestRecord,
  PartRequestStatusValue,
  StockPresentation,
} from "@/components/technician/partsWorkspaceTypes";

type CatalogueLike = {
  _id?: string;
  part_id?: string;
  nom_piece?: string;
  ref_constructeur?: string;
  fabricant?: string;
  categorie_piece?: string;
};

export type TechnicianStock = {
  _id: string;
  stock_id: string;
  part_id?: string | CatalogueLike;
  quantite_en_stock?: number;
  quantite_reservee?: number;
  seuil_alerte_stock?: number;
  quantite_minimale?: number;
  emplacement?: string;
};

export function partSummary(
  part: TechnicianStock["part_id"],
  fallback: string,
): { id?: string; name: string; ref?: string; fabricant?: string; category?: string } {
  if (!part) return { name: fallback };
  if (typeof part === "string") return { id: part, name: part || fallback };
  return {
    id: part._id,
    name: part.nom_piece || part.part_id || fallback,
    ref: part.ref_constructeur,
    fabricant: part.fabricant,
    category: part.categorie_piece,
  };
}

export function availableQuantity(stock: TechnicianStock): number {
  return Math.max(
    0,
    (stock.quantite_en_stock ?? 0) - (stock.quantite_reservee ?? 0),
  );
}

export function presentStock(stock: TechnicianStock): StockPresentation {
  const total = stock.quantite_en_stock ?? 0;
  const reserved = stock.quantite_reservee ?? 0;
  const available = Math.max(0, total - reserved);
  const minimum = stock.quantite_minimale ?? stock.seuil_alerte_stock ?? 0;
  let availability: AvailabilityState;
  if (total <= 0) {
    availability = "out_of_stock";
  } else if (available <= 0) {
    availability = "reserved_only";
  } else if (minimum > 0 && available <= minimum) {
    availability = "low_stock";
  } else {
    availability = "in_stock";
  }
  return { stock: total, reserved, available, minimum, availability };
}

export function searchStocks(
  stocks: TechnicianStock[],
  term: string,
): TechnicianStock[] {
  const query = term.trim().toLowerCase();
  if (!query) return stocks;
  return stocks.filter((stock) => {
    const part = stock.part_id;
    const partName = typeof part === "object" && part
      ? [part.nom_piece, part.part_id, part.ref_constructeur, part.fabricant, part.categorie_piece]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
      : "";
    return (
      partName.includes(query) ||
      (stock.stock_id || "").toLowerCase().includes(query) ||
      (stock.emplacement || "").toLowerCase().includes(query)
    );
  });
}

export function filterStocksByAvailability(
  stocks: TechnicianStock[],
  availability: "all" | AvailabilityState,
): TechnicianStock[] {
  if (availability === "all") return stocks;
  return stocks.filter((stock) => presentStock(stock).availability === availability);
}

export function availabilityStateOrder(state: AvailabilityState): number {
  if (state === "out_of_stock") return 0;
  if (state === "reserved_only") return 1;
  if (state === "low_stock") return 2;
  return 3;
}

export function isPartRequestStatus(value: unknown): value is PartRequestStatusValue {
  return (
    value === "pending" ||
    value === "reserved" ||
    value === "fulfilled" ||
    value === "cancelled"
  );
}

export function asPartRequestRecord(value: unknown): PartRequestRecord | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const status = record.status;
  if (!isPartRequestStatus(status)) return null;
  return {
    _id: String(record._id || ""),
    request_id: String(record.request_id || record._id || ""),
    ot_id: String(record.ot_id || ""),
    part_id: String(record.part_id || ""),
    quantity: Number(record.quantity) || 0,
    status,
    requested_at: String(record.requested_at || ""),
    part: record.part && typeof record.part === "object"
      ? (record.part as PartRequestRecord["part"])
      : undefined,
  };
}

export function isRequestFulfilled(
  request: PartRequestRecord,
  usedPartIds: Set<string>,
): boolean {
  return usedPartIds.has(String(request.part_id || ""));
}

export function effectiveRequestStatus(
  request: PartRequestRecord,
  usedPartIds: Set<string>,
): PartRequestStatusValue {
  if (request.status === "cancelled" || request.status === "reserved") {
    return request.status;
  }
  if (isRequestFulfilled(request, usedPartIds)) {
    return "fulfilled";
  }
  return "pending";
}

export function statusTone(status: PartRequestStatusValue): {
  bg: string;
  text: string;
  border: string;
} {
  switch (status) {
    case "fulfilled":
      return {
        bg: "bg-emerald-50",
        text: "text-emerald-700",
        border: "border-emerald-200",
      };
    case "reserved":
      return {
        bg: "bg-blue-50",
        text: "text-blue-700",
        border: "border-blue-200",
      };
    case "cancelled":
      return {
        bg: "bg-slate-100",
        text: "text-slate-600",
        border: "border-slate-300",
      };
    case "pending":
    default:
      return {
        bg: "bg-amber-50",
        text: "text-amber-700",
        border: "border-amber-200",
      };
  }
}

export function availabilityTone(availability: AvailabilityState): {
  bg: string;
  text: string;
  border: string;
} {
  switch (availability) {
    case "out_of_stock":
      return {
        bg: "bg-red-50",
        text: "text-red-700",
        border: "border-red-200",
      };
    case "reserved_only":
      return {
        bg: "bg-orange-50",
        text: "text-orange-700",
        border: "border-orange-200",
      };
    case "low_stock":
      return {
        bg: "bg-amber-50",
        text: "text-amber-700",
        border: "border-amber-200",
      };
    case "in_stock":
    default:
      return {
        bg: "bg-emerald-50",
        text: "text-emerald-700",
        border: "border-emerald-200",
      };
  }
}
