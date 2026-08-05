import { InterventionReportResponse } from '../../common/response/intervention-report-response';
import { LubricationLogResponse } from './lubrication-log-response.types';
import { WorkOrderResponse } from './work-order-response.types';

/** `POST /operator/report-problem` response — never a raw Mongoose document. */
export interface CorrectiveReportForOperatorResponse {
  workOrder: WorkOrderResponse;
  report: InterventionReportResponse;
  duplicate: boolean;
}

/** `POST /operator/preventive/submit` response — never a raw Mongoose document. */
export interface PreventiveSubmissionForOperatorResponse {
  workOrder: WorkOrderResponse;
  report: InterventionReportResponse;
  lubricationLog: LubricationLogResponse | null;
}
