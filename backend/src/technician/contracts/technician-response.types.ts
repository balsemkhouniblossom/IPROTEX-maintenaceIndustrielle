import { InterventionReportResponse } from '../../common/response/intervention-report-response';
import { OTPiecesDocument } from '../../schemas/ot-pieces.schema';
import { StockDocument } from '../../schemas/stock.schema';
import { DocumentDocument } from '../../schemas/document.schema';
import { WorkOrderResponse } from '../../work-orders/contracts/work-order-response.types';

/**
 * `parts`/`stock` keep their raw populated-document shape (Catalogue has no
 * sensitive fields to hide, unlike User) rather than a dedicated mapper —
 * only `workOrder`/`report` go through the shared response contracts
 * because those are the fields with a populated-User-ref sensitivity
 * concern.
 */
export interface TechnicianWorkOrderDetailResponse {
  workOrder: WorkOrderResponse;
  report: InterventionReportResponse | null;
  parts: OTPiecesDocument[];
  stock: StockDocument[];
  manuals: DocumentDocument[];
}
