/** The actual serialized shape of a Lubrication Log — no ref is populated on this specific code path (freshly created, never re-fetched with populate). */
export interface LubricationLogResponse {
  _id: string;
  log_id: string;
  module_id: string;
  lubrifiant_id: string;
  date_application: string;
  quantite: number;
  technician_id: string;
}
