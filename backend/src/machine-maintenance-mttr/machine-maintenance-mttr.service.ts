import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import {
  MachineMaintenanceMttrEntry,
  MachineMaintenanceMttrEntryDocument,
} from '../schemas/machine-maintenance-mttr-entry.schema';
import { Machine, MachineDocument } from '../schemas/machine.schema';
import {
  MachineType,
  MachineTypeDocument,
} from '../schemas/machine-type.schema';
import {
  CreateMachineMaintenanceMttrDto,
  UpdateMachineMaintenanceMttrDto,
} from './dto/machine-maintenance-mttr.dto';
import {
  getBusinessTimezone,
  parseBusinessDateInput,
} from '../common/business-time';

@Injectable()
export class MachineMaintenanceMttrService {
  constructor(
    @InjectModel(MachineMaintenanceMttrEntry.name)
    private readonly entryModel: Model<MachineMaintenanceMttrEntryDocument>,
    @InjectModel(Machine.name)
    private readonly machineModel: Model<MachineDocument>,
    @InjectModel(MachineType.name)
    private readonly machineTypeModel: Model<MachineTypeDocument>,
  ) {}

  private dates(startValue: string | Date, endValue: string | Date) {
    const startedAt = new Date(startValue);
    const endedAt = new Date(endValue);
    if (
      Number.isNaN(startedAt.getTime()) ||
      Number.isNaN(endedAt.getTime()) ||
      endedAt <= startedAt
    ) {
      throw new BadRequestException(
        'Restart time must be later than the machine stop time',
      );
    }
    return {
      startedAt,
      endedAt,
      durationMinutes: (endedAt.getTime() - startedAt.getTime()) / 60_000,
    };
  }

  async createFromOperator(input: {
    machineId: Types.ObjectId;
    machineTypeId: Types.ObjectId;
    workOrderId: Types.ObjectId;
    reportId: Types.ObjectId;
    operatorId: Types.ObjectId;
    startedAt: Date;
    endedAt: Date;
    description?: string;
    session: ClientSession;
  }) {
    const dates = this.dates(input.startedAt, input.endedAt);
    const [entry] = await this.entryModel.create(
      [
        {
          machine_id: input.machineId,
          machine_type_id: input.machineTypeId,
          work_order_id: input.workOrderId,
          intervention_report_id: input.reportId,
          started_at: dates.startedAt,
          ended_at: dates.endedAt,
          duration_minutes: dates.durationMinutes,
          source: 'OPERATOR_REPORT',
          description: input.description?.trim() || undefined,
          entered_by: input.operatorId,
        },
      ],
      { session: input.session },
    );
    return entry;
  }

  async getYear(yearInput?: string) {
    const year =
      yearInput === undefined ? new Date().getUTCFullYear() : Number(yearInput);
    if (!Number.isInteger(year) || year < 2000 || year > 2200)
      throw new BadRequestException('Invalid year');
    const timeZone = getBusinessTimezone();
    const start = parseBusinessDateInput(`${year}-01-01`, timeZone);
    const end = parseBusinessDateInput(`${year + 1}-01-01`, timeZone);
    const [types, entries, machines] = await Promise.all([
      this.machineTypeModel.find().sort({ name: 1 }).lean().exec(),
      this.entryModel
        .find({ ended_at: { $gte: start, $lt: end } })
        .sort({ ended_at: -1 })
        .lean()
        .exec(),
      this.machineModel
        .find()
        .select({ _id: 1, machine_id: 1, reference: 1, type_id: 1 })
        .sort({ machine_id: 1 })
        .lean()
        .exec(),
    ]);
    const machineMap = new Map(
      machines.map((machine) => [machine._id.toString(), machine]),
    );
    const serialize = (entry: (typeof entries)[number]) => {
      const machine = machineMap.get(entry.machine_id.toString());
      return {
        id: entry._id.toString(),
        machineId: entry.machine_id.toString(),
        machineCode: machine?.machine_id ?? '—',
        machineReference: machine?.reference ?? null,
        machineTypeId: entry.machine_type_id.toString(),
        workOrderId: entry.work_order_id?.toString() ?? null,
        reportId: entry.intervention_report_id?.toString() ?? null,
        startedAt: entry.started_at.toISOString(),
        endedAt: entry.ended_at.toISOString(),
        durationMinutes: entry.duration_minutes,
        source: entry.source,
        description: entry.description ?? '',
      };
    };
    const processes = types.map((type) => {
      const typeEntries = entries.filter(
        (entry) => entry.machine_type_id.toString() === type._id.toString(),
      );
      const months = Array.from({ length: 12 }, (_, index) => {
        const records = typeEntries.filter(
          (entry) =>
            Number(
              new Intl.DateTimeFormat('en-US', {
                month: 'numeric',
                timeZone,
              }).format(entry.ended_at),
            ) ===
            index + 1,
        );
        const totalMinutes = records.reduce(
          (sum, entry) => sum + entry.duration_minutes,
          0,
        );
        return {
          month: index + 1,
          interventionCount: records.length,
          totalMinutes,
          mttrMinutes: records.length ? totalMinutes / records.length : null,
          records: records.map(serialize),
        };
      });
      return { machineTypeId: type._id.toString(), name: type.name, months };
    });
    const totalMinutes = entries.reduce(
      (sum, entry) => sum + entry.duration_minutes,
      0,
    );
    return {
      year,
      timeZone,
      unit: 'MINUTES',
      processes,
      machines: machines.map((machine) => ({
        id: machine._id.toString(),
        code: machine.machine_id,
        reference: machine.reference ?? null,
        machineTypeId: machine.type_id.toString(),
      })),
      summary: {
        interventionCount: entries.length,
        totalMinutes,
        mttrMinutes: entries.length ? totalMinutes / entries.length : null,
      },
    };
  }

  async create(input: CreateMachineMaintenanceMttrDto, userId: string) {
    const machine = await this.machineModel.findById(input.machineId).exec();
    if (!machine) throw new NotFoundException('Machine not found');
    const dates = this.dates(input.startedAt, input.endedAt);
    return this.entryModel.create({
      machine_id: machine._id,
      machine_type_id: machine.type_id,
      started_at: dates.startedAt,
      ended_at: dates.endedAt,
      duration_minutes: dates.durationMinutes,
      source: 'ADMIN_MANUAL',
      description: input.description?.trim() || undefined,
      entered_by: new Types.ObjectId(userId),
    });
  }

  async update(
    id: string,
    input: UpdateMachineMaintenanceMttrDto,
    userId: string,
  ) {
    if (!Types.ObjectId.isValid(id))
      throw new BadRequestException('Invalid id');
    const entry = await this.entryModel.findById(id).exec();
    if (!entry) throw new NotFoundException('MTTR intervention not found');
    const machine = await this.machineModel
      .findById(input.machineId ?? entry.machine_id)
      .exec();
    if (!machine) throw new NotFoundException('Machine not found');
    const dates = this.dates(
      input.startedAt ?? entry.started_at,
      input.endedAt ?? entry.ended_at,
    );
    entry.machine_id = machine._id;
    entry.machine_type_id = machine.type_id;
    entry.started_at = dates.startedAt;
    entry.ended_at = dates.endedAt;
    entry.duration_minutes = dates.durationMinutes;
    if (input.description !== undefined)
      entry.description = input.description.trim();
    entry.updated_by = new Types.ObjectId(userId);
    return entry.save();
  }

  async remove(id: string) {
    if (!Types.ObjectId.isValid(id))
      throw new BadRequestException('Invalid id');
    const deleted = await this.entryModel.findByIdAndDelete(id).exec();
    if (!deleted) throw new NotFoundException('MTTR intervention not found');
    return { deleted: true };
  }
}
