import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  MachineMaintenanceMttrEntry,
  MachineMaintenanceMttrEntrySchema,
} from '../schemas/machine-maintenance-mttr-entry.schema';
import { Machine, MachineSchema } from '../schemas/machine.schema';
import { MachineType, MachineTypeSchema } from '../schemas/machine-type.schema';
import { MachineMaintenanceMttrController } from './machine-maintenance-mttr.controller';
import { MachineMaintenanceMttrService } from './machine-maintenance-mttr.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: MachineMaintenanceMttrEntry.name,
        schema: MachineMaintenanceMttrEntrySchema,
      },
      { name: Machine.name, schema: MachineSchema },
      { name: MachineType.name, schema: MachineTypeSchema },
    ]),
  ],
  controllers: [MachineMaintenanceMttrController],
  providers: [MachineMaintenanceMttrService],
  exports: [MachineMaintenanceMttrService],
})
export class MachineMaintenanceMttrModule {}
