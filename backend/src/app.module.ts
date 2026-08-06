import { Logger, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import {
  buildSlowQueryLogMessage,
  isSlowQuery,
  type MongoCommandSucceededEvent,
} from './common/slow-query-logger';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { User, UserSchema } from './schemas/user.schema';
import { MachineType, MachineTypeSchema } from './schemas/machine-type.schema';
import { Machine, MachineSchema } from './schemas/machine.schema';
import { ModuleType, ModuleTypeSchema } from './schemas/module-type.schema';
import { Module as ModuleEntity, ModuleSchema } from './schemas/module.schema';
import { Capteur, CapteurSchema } from './schemas/capteur.schema';
import { Mesure, MesureSchema } from './schemas/mesure.schema';
import { Catalogue, CatalogueSchema } from './schemas/catalogue.schema';
import { Stock, StockSchema } from './schemas/stock.schema';
import {
  ModulePieces,
  ModulePiecesSchema,
} from './schemas/module-pieces.schema';
import {
  MaintenancePlan,
  MaintenancePlanSchema,
} from './schemas/maintenance-plan.schema';
import { WorkOrder, WorkOrderSchema } from './schemas/work-order.schema';
import {
  InterventionReport,
  InterventionReportSchema,
} from './schemas/intervention-report.schema';
import { OTPieces, OTPiecesSchema } from './schemas/ot-pieces.schema';
import { Lubrifiant, LubrifiantSchema } from './schemas/lubrifiant.schema';
import {
  LubrificationLog,
  LubrificationLogSchema,
} from './schemas/lubrification-log.schema';
import { Panne, PanneSchema } from './schemas/panne.schema';
import {
  PanneSolution,
  PanneSolutionSchema,
} from './schemas/panne-solution.schema';
import { KPI, KPISchema } from './schemas/kpi.schema';
import { UsersModule } from './users/users.module';
import { MachinesModule } from './machines/machines.module';
import { WorkOrdersModule } from './work-orders/work-orders.module';
import { MachineTypesModule } from './machine-types/machine-types.module';
import { CataloguesModule } from './catalogues/catalogues.module';
import { ModuleTypesModule } from './module-types/module-types.module';
import { CapteursModule } from './capteurs/capteurs.module';
import { AuthModule } from './auth/auth.module';

import { CounterModule } from './counters/counter.module';
import { DocumentsModule } from './documents/documents.module';
import { InterventionReportsModule } from './intervention-reports/intervention-reports.module';
import { PannesModule } from './pannes/pannes.module';
import { PanneSolutionsModule } from './panne-solutions/panne-solutions.module';
import { ModulesModule } from './modules/modules.module';
import { MaintenancePlansModule } from './maintenance-plans/maintenance-plans.module';
import { StocksModule } from './stocks/stocks.module';
import { KpisModule } from './kpis/kpis.module';
import { LubrifiantsModule } from './lubrifiants/lubrifiants.module';
import { LubrificationLogsModule } from './lubrification-logs/lubrification-logs.module';
import { OtPiecesModule } from './ot-pieces/ot-pieces.module';
import { HealthModule } from './health/health.module';
import { OperatorModule } from './operator/operator.module';
import { RequestLoggingMiddleware } from './common/middleware/request-logging.middleware';
import { RequestContextMiddleware } from './common/middleware/request-context.middleware';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { EmailModule } from './email/email.module';
import { RequestContextModule } from './common/request-context.module';
import { NotificationsModule } from './notifications/notifications.module';
import { NotificationCenterModule } from './notification-center/notification-center.module';
import { ScheduleModule } from '@nestjs/schedule';
import { AutomationModule } from './automation/automation.module';
import { MesuresModule } from './mesures/mesures.module';
import { ModulePiecesModule } from './module-pieces/module-pieces.module';
import { PreventiveTasksModule } from './preventive-tasks/preventive-tasks.module';
import { TechnicianModule } from './technician/technician.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { KnowledgeBaseModule } from './knowledge-base/knowledge-base.module';
import { DeviceMonitoringModule } from './device-monitoring/device-monitoring.module';
import { AiAssistantModule } from './ai-assistant/ai-assistant.module';
import { PredictiveMaintenanceModule } from './predictive-maintenance/predictive-maintenance.module';
import { ReportsModule } from './reports/reports.module';
import { SavedViewsModule } from './saved-views/saved-views.module';
import { MachineTimelineModule } from './machine-timeline/machine-timeline.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { RolesGuard } from './auth/roles.guard';
import { AppThrottlerGuard } from './common/throttler/app-throttler.guard';
import { MetricsModule } from './common/metrics/metrics.module';
const mongoLogger = new Logger('MongoDB');
const SLOW_QUERY_THRESHOLD_MS =
  Number(process.env.SLOW_QUERY_THRESHOLD_MS) || 200;

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        `.env.${process.env.NODE_ENV ?? 'local'}`,
        '.env.local',
        '.env',
      ],
    }),
    RequestContextModule,
    ScheduleModule.forRoot(),
    CounterModule,
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        throttlers: [
          {
            name: 'default',
            ttl: configService.get<number>('THROTTLE_DEFAULT_TTL_MS') ?? 60000,
            limit: configService.get<number>('THROTTLE_DEFAULT_LIMIT') ?? 120,
          },
          {
            name: 'device',
            ttl: configService.get<number>('THROTTLE_DEVICE_TTL_MS') ?? 60000,
            limit: configService.get<number>('THROTTLE_DEVICE_LIMIT') ?? 120,
          },
        ],
        skipIf: () => {
          const enabled = configService.get<string>('THROTTLE_ENABLED');
          if (process.env.NODE_ENV === 'test') {
            return enabled !== 'true';
          }
          return false;
        },
      }),
    }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const mongoUri =
          configService.get<string>('MONGODB_URI') ??
          'mongodb://localhost:27017/GMAO_IPROTEX_TEST';

        return {
          uri: mongoUri,
          autoCreate: process.env.NODE_ENV !== 'production',
          autoIndex: process.env.NODE_ENV !== 'production',
          // Required for the native driver to emit the `commandSucceeded`
          // events the slow-query listener below depends on — Mongoose's
          // own `debug` mode fires *before* a command runs, so it never
          // has a duration to compare against a threshold with.
          monitorCommands: true,
          connectionFactory: (connection: Connection) => {
            connection.on('connected', () => {
              const host = connection.host || 'unknown-host';
              const dbName = connection.name || 'unknown-db';
              mongoLogger.log(`Connected to MongoDB host=${host} db=${dbName}`);
            });

            connection.on('disconnected', () => {
              mongoLogger.warn('MongoDB connection disconnected');
            });

            connection.on('reconnected', () => {
              mongoLogger.log('MongoDB connection reconnected');
            });

            connection.on('error', (error: Error) => {
              mongoLogger.error(`MongoDB connection error: ${error.message}`);
            });

            connection
              .getClient()
              .on('commandSucceeded', (event: MongoCommandSucceededEvent) => {
                if (isSlowQuery(event, SLOW_QUERY_THRESHOLD_MS)) {
                  mongoLogger.warn(buildSlowQueryLogMessage(event));
                }
              });

            return connection;
          },
        };
      },
    }),

    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: MachineType.name, schema: MachineTypeSchema },
      { name: Machine.name, schema: MachineSchema },
      { name: ModuleType.name, schema: ModuleTypeSchema },
      { name: ModuleEntity.name, schema: ModuleSchema },
      { name: Capteur.name, schema: CapteurSchema },
      { name: Mesure.name, schema: MesureSchema },
      { name: Catalogue.name, schema: CatalogueSchema },
      { name: Stock.name, schema: StockSchema },
      { name: ModulePieces.name, schema: ModulePiecesSchema },
      { name: MaintenancePlan.name, schema: MaintenancePlanSchema },
      { name: WorkOrder.name, schema: WorkOrderSchema },
      { name: InterventionReport.name, schema: InterventionReportSchema },
      { name: OTPieces.name, schema: OTPiecesSchema },
      { name: Lubrifiant.name, schema: LubrifiantSchema },
      { name: LubrificationLog.name, schema: LubrificationLogSchema },
      { name: Panne.name, schema: PanneSchema },
      { name: PanneSolution.name, schema: PanneSolutionSchema },
      { name: KPI.name, schema: KPISchema },
    ]),
    UsersModule,
    MachinesModule,
    WorkOrdersModule,
    MachineTypesModule,
    CataloguesModule,
    ModuleTypesModule,
    CapteursModule,
    AuthModule,
    EmailModule,
    NotificationsModule,
    NotificationCenterModule,
    AutomationModule,
    DocumentsModule, // ✅ MUST be here
    InterventionReportsModule,
    PannesModule,
    PanneSolutionsModule,
    ModulesModule,
    MaintenancePlansModule,
    StocksModule,
    KpisModule,
    LubrifiantsModule,
    LubrificationLogsModule,
    OtPiecesModule,
    HealthModule,
    OperatorModule,
    MesuresModule,
    ModulePiecesModule,
    PreventiveTasksModule,
    TechnicianModule,
    DashboardModule,
    KnowledgeBaseModule,
    DeviceMonitoringModule,
    AiAssistantModule,
    PredictiveMaintenanceModule,
    ReportsModule,
    SavedViewsModule,
    MachineTimelineModule,
    MetricsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
    {
      provide: APP_GUARD,
      useClass: AppThrottlerGuard,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(RequestContextMiddleware, RequestLoggingMiddleware)
      .forRoutes('*');
  }
}
