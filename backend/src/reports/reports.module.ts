import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { GeneratedReport, GeneratedReportSchema } from '../schemas/generated-report.schema';
import { ScheduledReport, ScheduledReportSchema } from '../schemas/scheduled-report.schema';
import { WorkOrder, WorkOrderSchema } from '../schemas/work-order.schema';
import {
  InterventionReport,
  InterventionReportSchema,
} from '../schemas/intervention-report.schema';
import { Machine, MachineSchema } from '../schemas/machine.schema';
import { StockMovement, StockMovementSchema } from '../schemas/stock-movement.schema';
import { Catalogue, CatalogueSchema } from '../schemas/catalogue.schema';
import { FaultEvent, FaultEventSchema } from '../schemas/fault-event.schema';
import { DocumentEntity, DocumentSchema } from '../schemas/document.schema';
import { MaintenancePlan, MaintenancePlanSchema } from '../schemas/maintenance-plan.schema';
import { User, UserSchema } from '../schemas/user.schema';
import { DocumentsModule } from '../documents/documents.module';
import { KpiModule } from '../kpi/kpi.module';
import { PredictiveMaintenanceModule } from '../predictive-maintenance/predictive-maintenance.module';
import { NotificationCenterModule } from '../notification-center/notification-center.module';
import { FileStorageModule } from '../storage/file-storage.module';
import { REPORT_DATA_PROVIDERS, REPORT_RENDERERS } from './report.interfaces';
import { MachineHistoryReportProvider } from './providers/machine-history.provider';
import { PreventiveComplianceReportProvider } from './providers/preventive-compliance.provider';
import { CorrectiveDowntimeReportProvider } from './providers/corrective-downtime.provider';
import { MttrMtbfTrendsReportProvider } from './providers/mttr-mtbf-trends.provider';
import { StockMovementsReportProvider } from './providers/stock-movements.provider';
import { MaintenanceCostsReportProvider } from './providers/maintenance-costs.provider';
import { TechnicianWorkloadReportProvider } from './providers/technician-workload.provider';
import { FaultFrequencyReportProvider } from './providers/fault-frequency.provider';
import { AuditHistoryReportProvider } from './providers/audit-history.provider';
import { PredictiveRiskReportProvider } from './providers/predictive-risk.provider';
import { CsvReportRenderer } from './renderers/csv-report-renderer';
import { ExcelReportRenderer } from './renderers/excel-report-renderer';
import { PdfReportRenderer } from './renderers/pdf-report-renderer';
import { ReportsService } from './reports.service';
import { ScheduledReportsService } from './scheduled-reports.service';
import { ReportSchedulerService } from './report-scheduler.service';
import { ReportsController } from './reports.controller';

const DATA_PROVIDERS = [
  MachineHistoryReportProvider,
  PreventiveComplianceReportProvider,
  CorrectiveDowntimeReportProvider,
  MttrMtbfTrendsReportProvider,
  StockMovementsReportProvider,
  MaintenanceCostsReportProvider,
  TechnicianWorkloadReportProvider,
  FaultFrequencyReportProvider,
  AuditHistoryReportProvider,
  PredictiveRiskReportProvider,
];

const RENDERERS = [CsvReportRenderer, ExcelReportRenderer, PdfReportRenderer];

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: GeneratedReport.name, schema: GeneratedReportSchema },
      { name: ScheduledReport.name, schema: ScheduledReportSchema },
      { name: WorkOrder.name, schema: WorkOrderSchema },
      { name: InterventionReport.name, schema: InterventionReportSchema },
      { name: Machine.name, schema: MachineSchema },
      { name: StockMovement.name, schema: StockMovementSchema },
      { name: Catalogue.name, schema: CatalogueSchema },
      { name: FaultEvent.name, schema: FaultEventSchema },
      { name: DocumentEntity.name, schema: DocumentSchema },
      { name: MaintenancePlan.name, schema: MaintenancePlanSchema },
      { name: User.name, schema: UserSchema },
    ]),
    DocumentsModule,
    KpiModule,
    PredictiveMaintenanceModule,
    NotificationCenterModule,
    FileStorageModule,
  ],
  controllers: [ReportsController],
  providers: [
    ...DATA_PROVIDERS,
    ...RENDERERS,
    {
      provide: REPORT_DATA_PROVIDERS,
      useFactory: (...providers: unknown[]) => providers,
      inject: DATA_PROVIDERS,
    },
    {
      provide: REPORT_RENDERERS,
      useFactory: (...renderers: unknown[]) => renderers,
      inject: RENDERERS,
    },
    ReportsService,
    ScheduledReportsService,
    ReportSchedulerService,
  ],
})
export class ReportsModule {}
