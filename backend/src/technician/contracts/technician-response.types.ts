import { InterventionReportResponse } from '../../common/response/intervention-report-response';
import {
  CatalogueSummaryResponse,
  StockResponse,
} from '../../common/response/catalogue-response';
import { DocumentSummaryResponse } from '../../common/response/document-response';
import { WorkOrderResponse } from '../../work-orders/contracts/work-order-response.types';

/** The actual serialized shape of an OTPieces row — `part_id` is a plain ObjectId string on endpoints that don't populate it and a `CatalogueSummaryResponse` on endpoints that do. */
export interface TechnicianPartResponse {
  _id: string;
  ot_id: string;
  part_id: string | CatalogueSummaryResponse;
  quantite: number;
}

export interface TechnicianWorkOrderDetailResponse {
  workOrder: WorkOrderResponse;
  report: InterventionReportResponse | null;
  parts: TechnicianPartResponse[];
  stock: StockResponse[];
  manuals: DocumentSummaryResponse[];
}
