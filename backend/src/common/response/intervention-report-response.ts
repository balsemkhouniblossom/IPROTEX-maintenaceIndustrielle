import { UserSummaryResponse } from './reference-summaries';
import {
  mapPopulatedRef,
  serializeDate,
  serializeObjectId,
} from './serialization.util';
import {
  InterventionReport,
  InterventionReportDocument,
} from '../../schemas/intervention-report.schema';
import { WorkOrderDocument } from '../../schemas/work-order.schema';
import { toWorkOrderResponse } from '../../work-orders/contracts/work-order-response.mapper';
import { WorkOrderResponse } from '../../work-orders/contracts/work-order-response.types';

/**
 * The actual serialized shape of an Intervention Report as returned by
 * every endpoint that fetches one — `technician_id` is a plain ObjectId
 * string on endpoints that don't populate it and a `SAFE_USER_PROJECTION`
 * summary (`nom_complet user_id role`) on endpoints that do; `ot_id` is a
 * plain ObjectId string on endpoints that don't populate it and a full
 * `WorkOrderResponse` on endpoints (e.g. the Operator's own report list)
 * that do. All are real, currently-occurring shapes.
 */
export interface InterventionReportResponse {
  _id: string;
  report_id: string;
  ot_id: string | WorkOrderResponse;
  technician_id?: string | UserSummaryResponse | null;
  date_debut: string;
  date_fin: string;
  cause_racine?: string;
  description_action?: string;
  etat_final?: string;
  validation_responsable?: string;
  validated_by?: string;
  validated_at?: string;
}

type InterventionReportLike = (
  | InterventionReport
  | InterventionReportDocument
) & {
  _id: unknown;
};

type SafeTechnicianRef = {
  _id: unknown;
  user_id?: string;
  nom_complet?: string;
  role?: string;
};

export function toInterventionReportResponse(
  doc: InterventionReportLike,
): InterventionReportResponse {
  return {
    _id: serializeObjectId(doc._id as string)!,
    report_id: doc.report_id,
    ot_id: mapPopulatedRef(
      doc.ot_id as unknown as WorkOrderDocument | string,
      toWorkOrderResponse,
    )!,
    technician_id: mapPopulatedRef(
      doc.technician_id as unknown as
        | SafeTechnicianRef
        | string
        | undefined
        | null,
      (ref) => ({
        _id: serializeObjectId(ref._id as string)!,
        user_id: ref.user_id,
        nom_complet: ref.nom_complet,
        role: ref.role,
      }),
    ),
    date_debut: serializeDate(doc.date_debut)!,
    date_fin: serializeDate(doc.date_fin)!,
    cause_racine: doc.cause_racine,
    description_action: doc.description_action,
    etat_final: doc.etat_final,
    validation_responsable: doc.validation_responsable,
    validated_by: serializeObjectId(doc.validated_by),
    validated_at: serializeDate(doc.validated_at),
  };
}

export function toInterventionReportResponseOrNull(
  doc: InterventionReportLike | null | undefined,
): InterventionReportResponse | null {
  return doc ? toInterventionReportResponse(doc) : null;
}
