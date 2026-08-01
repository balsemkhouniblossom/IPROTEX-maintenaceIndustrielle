import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import {
  MachineHealthPrediction,
  MachineHealthPredictionSchema,
} from '../schemas/machine-health-prediction.schema';
import {
  PredictionModelVersion,
  PredictionModelVersionSchema,
} from '../schemas/prediction-model-version.schema';
import { Machine, MachineSchema } from '../schemas/machine.schema';
import { Module as ModuleEntity, ModuleSchema } from '../schemas/module.schema';
import {
  MaintenancePlan,
  MaintenancePlanSchema,
} from '../schemas/maintenance-plan.schema';
import { Telemetry, TelemetrySchema } from '../schemas/telemetry.schema';
import { FaultEvent, FaultEventSchema } from '../schemas/fault-event.schema';
import { WorkOrder, WorkOrderSchema } from '../schemas/work-order.schema';
import {
  InterventionReport,
  InterventionReportSchema,
} from '../schemas/intervention-report.schema';
import { DocumentsModule } from '../documents/documents.module';
import {
  PREDICTION_MODELS,
  PredictionModel,
} from './prediction-model.interface';
import { ZScoreModel } from './models/zscore.model';
import { IsolationForestModel } from './models/isolation-forest.model';
import { DbscanModel } from './models/dbscan.model';
import { AutoencoderModel } from './models/autoencoder.model';
import { FeatureExtractionService } from './feature-extraction.service';
import { TrainingSampleService } from './training-sample.service';
import { PredictiveMaintenanceTrainingService } from './predictive-maintenance-training.service';
import { PredictiveMaintenanceService } from './predictive-maintenance.service';
import { PredictiveMaintenanceSchedulerService } from './predictive-maintenance-scheduler.service';
import { PredictiveMaintenanceController } from './predictive-maintenance.controller';

@Module({
  imports: [
    ConfigModule,
    MongooseModule.forFeature([
      {
        name: MachineHealthPrediction.name,
        schema: MachineHealthPredictionSchema,
      },
      {
        name: PredictionModelVersion.name,
        schema: PredictionModelVersionSchema,
      },
      { name: Machine.name, schema: MachineSchema },
      { name: ModuleEntity.name, schema: ModuleSchema },
      { name: MaintenancePlan.name, schema: MaintenancePlanSchema },
      { name: Telemetry.name, schema: TelemetrySchema },
      { name: FaultEvent.name, schema: FaultEventSchema },
      { name: WorkOrder.name, schema: WorkOrderSchema },
      { name: InterventionReport.name, schema: InterventionReportSchema },
    ]),
    DocumentsModule,
  ],
  controllers: [PredictiveMaintenanceController],
  providers: [
    ZScoreModel,
    IsolationForestModel,
    DbscanModel,
    AutoencoderModel,
    {
      provide: PREDICTION_MODELS,
      useFactory: (
        zScore: ZScoreModel,
        isolationForest: IsolationForestModel,
        dbscan: DbscanModel,
        autoencoder: AutoencoderModel,
      ): PredictionModel[] => [zScore, isolationForest, dbscan, autoencoder],
      inject: [
        ZScoreModel,
        IsolationForestModel,
        DbscanModel,
        AutoencoderModel,
      ],
    },
    FeatureExtractionService,
    TrainingSampleService,
    PredictiveMaintenanceTrainingService,
    PredictiveMaintenanceService,
    PredictiveMaintenanceSchedulerService,
  ],
  exports: [PredictiveMaintenanceService],
})
export class PredictiveMaintenanceModule {}
