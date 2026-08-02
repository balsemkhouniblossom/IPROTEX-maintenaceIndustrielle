import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';

import { Device, DeviceSchema } from '../schemas/device.schema';
import { Telemetry, TelemetrySchema } from '../schemas/telemetry.schema';
import { FaultEvent, FaultEventSchema } from '../schemas/fault-event.schema';
import { Machine, MachineSchema } from '../schemas/machine.schema';
import { User, UserSchema } from '../schemas/user.schema';

import { resolveJwtSecret } from '../auth/jwt.strategy';
import { DocumentsModule } from '../documents/documents.module';
import { NotificationCenterModule } from '../notification-center/notification-center.module';
import { SchedulerSupportModule } from '../scheduler/scheduler-support.module';

import { DeviceAuthService } from './device-auth.service';
import { DeviceAuthGuard } from './device-auth.guard';
import { DevicesService } from './devices.service';
import { DevicesController } from './devices.controller';
import { TelemetryIngestionService } from './telemetry-ingestion.service';
import { DeviceGatewayController } from './device-gateway.controller';
import { MqttIngestionService } from './mqtt-ingestion.service';
import { LiveMonitoringGateway } from './live-monitoring.gateway';
import { LiveStatusService } from './live-status.service';
import { DeviceOfflineSweepService } from './device-offline-sweep.service';
import { LiveMonitoringController } from './live-monitoring.controller';

@Module({
  imports: [
    ConfigModule,
    MongooseModule.forFeature([
      { name: Device.name, schema: DeviceSchema },
      { name: Telemetry.name, schema: TelemetrySchema },
      { name: FaultEvent.name, schema: FaultEventSchema },
      { name: Machine.name, schema: MachineSchema },
      { name: User.name, schema: UserSchema },
    ]),
    // A dedicated JwtModule registration (rather than importing AuthModule)
    // keeps this module fully self-contained — it only needs to *verify*
    // tokens issued by AuthModule, using the exact same secret-resolution
    // rule, never to issue or sign its own.
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: resolveJwtSecret(configService),
      }),
    }),
    DocumentsModule,
    NotificationCenterModule,
    SchedulerSupportModule,
  ],
  controllers: [
    DevicesController,
    DeviceGatewayController,
    LiveMonitoringController,
  ],
  providers: [
    DeviceAuthService,
    DeviceAuthGuard,
    DevicesService,
    TelemetryIngestionService,
    LiveMonitoringGateway,
    LiveStatusService,
    DeviceOfflineSweepService,
    MqttIngestionService,
  ],
  exports: [LiveStatusService],
})
export class DeviceMonitoringModule {}
