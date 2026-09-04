export type PartRequestStatusValue =
  | "pending"
  | "reserved"
  | "fulfilled"
  | "cancelled";

export const PART_REQUEST_STATUS_VALUES: PartRequestStatusValue[] = [
  "pending",
  "reserved",
  "fulfilled",
  "cancelled",
];

export type PartRequestRecord = {
  _id: string;
  request_id: string;
  ot_id: string;
  part_id: string;
  quantity: number;
  status: PartRequestStatusValue;
  requested_at: string;
  part?: {
    _id?: string;
    part_id?: string;
    nom_piece?: string;
    ref_constructeur?: string;
    fabricant?: string;
    categorie_piece?: string;
  };
};

export type AvailabilityState =
  | "in_stock"
  | "low_stock"
  | "out_of_stock"
  | "reserved_only";

export type StockPresentation = {
  stock: number;
  reserved: number;
  available: number;
  minimum: number;
  availability: AvailabilityState;
};
