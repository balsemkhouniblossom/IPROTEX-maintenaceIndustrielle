import type { Schema } from 'mongoose';
import { User, UserSchema } from '../schemas/user.schema';
import { MachineType, MachineTypeSchema } from '../schemas/machine-type.schema';
import { Machine, MachineSchema } from '../schemas/machine.schema';
import { ModuleType, ModuleTypeSchema } from '../schemas/module-type.schema';
import { Module as ModuleEntity, ModuleSchema } from '../schemas/module.schema';
import { Capteur, CapteurSchema } from '../schemas/capteur.schema';
import { Mesure, MesureSchema } from '../schemas/mesure.schema';
import { Catalogue, CatalogueSchema } from '../schemas/catalogue.schema';
import { Stock, StockSchema } from '../schemas/stock.schema';
import {
  ModulePieces,
  ModulePiecesSchema,
} from '../schemas/module-pieces.schema';
import {
  MaintenancePlan,
  MaintenancePlanSchema,
} from '../schemas/maintenance-plan.schema';
import { WorkOrder, WorkOrderSchema } from '../schemas/work-order.schema';
import {
  InterventionReport,
  InterventionReportSchema,
} from '../schemas/intervention-report.schema';
import { OTPieces, OTPiecesSchema } from '../schemas/ot-pieces.schema';
import { Lubrifiant, LubrifiantSchema } from '../schemas/lubrifiant.schema';
import {
  LubrificationLog,
  LubrificationLogSchema,
} from '../schemas/lubrification-log.schema';
import { Panne, PanneSchema } from '../schemas/panne.schema';
import {
  PanneSolution,
  PanneSolutionSchema,
} from '../schemas/panne-solution.schema';
import { KPI, KPISchema } from '../schemas/kpi.schema';
import {
  AiInteraction,
  AiInteractionSchema,
} from '../schemas/ai-interaction.schema';
import { FaultEvent, FaultEventSchema } from '../schemas/fault-event.schema';
import {
  AutomationJobLock,
  AutomationJobLockSchema,
} from '../schemas/automation-job-lock.schema';
import { DocumentEntity, DocumentSchema } from '../schemas/document.schema';
import {
  DocumentRejection,
  DocumentRejectionSchema,
} from '../schemas/document-rejection.schema';
import {
  KnowledgeArticle,
  KnowledgeArticleSchema,
} from '../schemas/knowledge-article.schema';
import { Device, DeviceSchema } from '../schemas/device.schema';
import { Telemetry, TelemetrySchema } from '../schemas/telemetry.schema';
import {
  PreventiveTask,
  PreventiveTaskSchema,
} from '../schemas/preventive-task.schema';
import {
  StockMovement,
  StockMovementSchema,
} from '../schemas/stock-movement.schema';
import { PartRequest, PartRequestSchema } from '../schemas/part-request.schema';
import { SavedView, SavedViewSchema } from '../schemas/saved-view.schema';
import {
  Notification,
  NotificationSchema,
} from '../schemas/notification.schema';
import {
  GeneratedReport,
  GeneratedReportSchema,
} from '../schemas/generated-report.schema';
import {
  ScheduledReport,
  ScheduledReportSchema,
} from '../schemas/scheduled-report.schema';
import {
  MachineHealthPrediction,
  MachineHealthPredictionSchema,
} from '../schemas/machine-health-prediction.schema';
import {
  PredictionModelVersion,
  PredictionModelVersionSchema,
} from '../schemas/prediction-model-version.schema';
import { Counter, CounterSchema } from '../counters/counter.schema';
import {
  GoogleLoginExchange,
  GoogleLoginExchangeSchema,
} from '../auth/schemas/google-login-exchange.schema';

export interface SchemaRegistryEntry {
  modelName: string;
  schema: Schema;
}

/**
 * Every top-level (independently-collection-backed) Mongoose schema in the
 * app, paired with the exact model name each feature module registers it
 * under via `MongooseModule.forFeature`. This is the single source of truth
 * `index-manager.ts` uses to discover schema-declared indexes (`@Prop`
 * unique/index options and `.index()` calls) so they get the same
 * production-verification and `--apply` coverage as the hand-curated
 * `RECOMMENDED_MONGODB_INDEXES` list, without hand-copying index
 * definitions into a second list that can drift.
 *
 * `schema-registry.spec.ts` asserts every `*.schema.ts` file under `src`
 * has an entry here, so a newly added schema can't silently fall outside
 * index verification the way `document.schema.ts` effectively did before
 * (see MongoDB index drift finding in the production-readiness audit).
 */
export const SCHEMA_REGISTRY: SchemaRegistryEntry[] = [
  { modelName: User.name, schema: UserSchema },
  { modelName: MachineType.name, schema: MachineTypeSchema },
  { modelName: Machine.name, schema: MachineSchema },
  { modelName: ModuleType.name, schema: ModuleTypeSchema },
  { modelName: ModuleEntity.name, schema: ModuleSchema },
  { modelName: Capteur.name, schema: CapteurSchema },
  { modelName: Mesure.name, schema: MesureSchema },
  { modelName: Catalogue.name, schema: CatalogueSchema },
  { modelName: Stock.name, schema: StockSchema },
  { modelName: ModulePieces.name, schema: ModulePiecesSchema },
  { modelName: MaintenancePlan.name, schema: MaintenancePlanSchema },
  { modelName: WorkOrder.name, schema: WorkOrderSchema },
  { modelName: InterventionReport.name, schema: InterventionReportSchema },
  { modelName: OTPieces.name, schema: OTPiecesSchema },
  { modelName: Lubrifiant.name, schema: LubrifiantSchema },
  { modelName: LubrificationLog.name, schema: LubrificationLogSchema },
  { modelName: Panne.name, schema: PanneSchema },
  { modelName: PanneSolution.name, schema: PanneSolutionSchema },
  { modelName: KPI.name, schema: KPISchema },
  { modelName: AiInteraction.name, schema: AiInteractionSchema },
  { modelName: FaultEvent.name, schema: FaultEventSchema },
  { modelName: AutomationJobLock.name, schema: AutomationJobLockSchema },
  { modelName: DocumentEntity.name, schema: DocumentSchema },
  { modelName: DocumentRejection.name, schema: DocumentRejectionSchema },
  { modelName: KnowledgeArticle.name, schema: KnowledgeArticleSchema },
  { modelName: Device.name, schema: DeviceSchema },
  { modelName: Telemetry.name, schema: TelemetrySchema },
  { modelName: PreventiveTask.name, schema: PreventiveTaskSchema },
  { modelName: StockMovement.name, schema: StockMovementSchema },
  { modelName: PartRequest.name, schema: PartRequestSchema },
  { modelName: SavedView.name, schema: SavedViewSchema },
  { modelName: Notification.name, schema: NotificationSchema },
  { modelName: GeneratedReport.name, schema: GeneratedReportSchema },
  { modelName: ScheduledReport.name, schema: ScheduledReportSchema },
  {
    modelName: MachineHealthPrediction.name,
    schema: MachineHealthPredictionSchema,
  },
  {
    modelName: PredictionModelVersion.name,
    schema: PredictionModelVersionSchema,
  },
  { modelName: Counter.name, schema: CounterSchema },
  { modelName: GoogleLoginExchange.name, schema: GoogleLoginExchangeSchema },
];
