import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Machine, MachineDocument } from '../schemas/machine.schema';
import {
  Module as ModuleEntity,
  ModuleDocument,
} from '../schemas/module.schema';
import { WorkOrder, WorkOrderDocument } from '../schemas/work-order.schema';
import { DocumentEntity, DocumentDocument } from '../schemas/document.schema';
import { Device, DeviceDocument } from '../schemas/device.schema';
import { FaultEvent, FaultEventDocument } from '../schemas/fault-event.schema';
import { Telemetry, TelemetryDocument } from '../schemas/telemetry.schema';
import {
  MachineHealthPrediction,
  MachineHealthPredictionDocument,
} from '../schemas/machine-health-prediction.schema';
import { KPI, KPIDocument } from '../schemas/kpi.schema';
import {
  KnowledgeArticle,
  KnowledgeArticleDocument,
} from '../schemas/knowledge-article.schema';
import {
  AiInteraction,
  AiInteractionDocument,
} from '../schemas/ai-interaction.schema';
import { CreateMachineDto } from './dto/create-machine.dto';
import { UpdateMachineDto } from './dto/update-machine.dto';
import { PaginatedResponse, toPaginatedResponse } from '../common/pagination';
import { assertNoDependencies } from '../common/dependency-protection';
import {
  toMachineResponse,
  toMachineResponseOrNull,
} from './contracts/machine-response.mapper';
import { MachineResponse } from './contracts/machine-response.types';

@Injectable()
export class MachinesService {
  constructor(
    @InjectModel(Machine.name) private machineModel: Model<MachineDocument>,
    @InjectModel(ModuleEntity.name)
    private moduleModel: Model<ModuleDocument>,
    @InjectModel(WorkOrder.name)
    private workOrderModel: Model<WorkOrderDocument>,
    @InjectModel(DocumentEntity.name)
    private documentModel: Model<DocumentDocument>,
    @InjectModel(Device.name) private deviceModel: Model<DeviceDocument>,
    @InjectModel(FaultEvent.name)
    private faultEventModel: Model<FaultEventDocument>,
    @InjectModel(Telemetry.name)
    private telemetryModel: Model<TelemetryDocument>,
    @InjectModel(MachineHealthPrediction.name)
    private machineHealthPredictionModel: Model<MachineHealthPredictionDocument>,
    @InjectModel(KPI.name) private kpiModel: Model<KPIDocument>,
    @InjectModel(KnowledgeArticle.name)
    private knowledgeArticleModel: Model<KnowledgeArticleDocument>,
    @InjectModel(AiInteraction.name)
    private aiInteractionModel: Model<AiInteractionDocument>,
  ) {}

  async create(createMachineDto: CreateMachineDto): Promise<MachineResponse> {
    const createdMachine = new this.machineModel({
      ...createMachineDto,
      lifecycle_history: [
        {
          action: 'created',
          to_status: createMachineDto.status,
          at: new Date(),
        },
      ],
    });
    const saved = await createdMachine.save();
    return toMachineResponse(saved);
  }

  async countAll(): Promise<number> {
    return this.machineModel.countDocuments().exec();
  }

  async findAll(
    page: number,
    limit: number,
    skip: number,
  ): Promise<PaginatedResponse<MachineResponse>> {
    const [items, totalItems] = await Promise.all([
      this.machineModel.find().skip(skip).limit(limit).exec(),
      this.machineModel.countDocuments().exec(),
    ]);

    return toPaginatedResponse(
      items.map(toMachineResponse),
      totalItems,
      page,
      limit,
    );
  }

  async findOne(id: string): Promise<MachineResponse | null> {
    const found = await this.machineModel.findById(id).exec();
    return toMachineResponseOrNull(found);
  }

  async update(
    id: string,
    updateMachineDto: UpdateMachineDto,
  ): Promise<MachineResponse | null> {
    if (updateMachineDto.status !== undefined) {
      const existing = await this.machineModel
        .findById(id)
        .select({ status: 1 })
        .exec();
      if (existing && existing.status !== updateMachineDto.status) {
        const updated = await this.machineModel
          .findByIdAndUpdate(
            id,
            {
              $set: updateMachineDto,
              $push: {
                lifecycle_history: {
                  action: 'status_changed',
                  from_status: existing.status,
                  to_status: updateMachineDto.status,
                  at: new Date(),
                },
              },
            },
            { new: true },
          )
          .exec();
        return toMachineResponseOrNull(updated);
      }
    }

    const updated = await this.machineModel
      .findByIdAndUpdate(id, updateMachineDto, { new: true })
      .exec();
    return toMachineResponseOrNull(updated);
  }

  async remove(id: string): Promise<MachineResponse | null> {
    await assertNoDependencies('Machine', [
      { label: 'modules', model: this.moduleModel, filter: { machine_id: id } },
      {
        label: 'work orders',
        model: this.workOrderModel,
        filter: { machine_id: id },
      },
      {
        label: 'documents',
        model: this.documentModel,
        filter: { machine_id: id },
      },
      { label: 'devices', model: this.deviceModel, filter: { machine_id: id } },
      {
        label: 'fault events',
        model: this.faultEventModel,
        filter: { machine_id: id },
      },
      {
        label: 'telemetry',
        model: this.telemetryModel,
        filter: { machine_id: id },
      },
      {
        label: 'health predictions',
        model: this.machineHealthPredictionModel,
        filter: { machine_id: id },
      },
      { label: 'KPIs', model: this.kpiModel, filter: { machine_id: id } },
      {
        label: 'knowledge articles',
        model: this.knowledgeArticleModel,
        filter: { machine_id: id },
      },
      {
        label: 'AI interaction history',
        model: this.aiInteractionModel,
        filter: { machine_id: id },
      },
    ]);
    const removed = await this.machineModel.findByIdAndDelete(id).exec();
    return toMachineResponseOrNull(removed);
  }
}
