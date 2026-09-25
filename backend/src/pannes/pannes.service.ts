import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { Panne, PanneDocument } from '../schemas/panne.schema';
import { CreatePanneDto } from './dto/create-panne.dto';
import { UpdatePanneDto } from './dto/update-panne.dto';
import { PaginatedResponse, toPaginatedResponse } from '../common/pagination';
import { PannePart, PannePartDocument } from '../schemas/panne-part.schema';
import {
  MachineType,
  MachineTypeDocument,
} from '../schemas/machine-type.schema';
import { Catalogue, CatalogueDocument } from '../schemas/catalogue.schema';
import { UpsertPannePartDto } from './dto/upsert-panne-part.dto';
import { ModuleType, ModuleTypeDocument } from '../schemas/module-type.schema';
import {
  ModulePieces,
  ModulePiecesDocument,
} from '../schemas/module-pieces.schema';

@Injectable()
export class PannesService {
  constructor(
    @InjectModel(Panne.name)
    private readonly panneModel: Model<PanneDocument>,
    @InjectModel(PannePart.name)
    private readonly pannePartModel: Model<PannePartDocument>,
    @InjectModel(MachineType.name)
    private readonly machineTypeModel: Model<MachineTypeDocument>,
    @InjectModel(Catalogue.name)
    private readonly catalogueModel: Model<CatalogueDocument>,
    @InjectModel(ModuleType.name)
    private readonly moduleTypeModel: Model<ModuleTypeDocument>,
    @InjectModel(ModulePieces.name)
    private readonly modulePiecesModel: Model<ModulePiecesDocument>,
  ) {}

  async create(createPanneDto: CreatePanneDto): Promise<Panne> {
    await this.assertMachineType(createPanneDto.machine_type_id);
    const createdPanne = new this.panneModel(createPanneDto);
    return createdPanne.save();
  }

  async findAll(
    page: number,
    limit: number,
    skip: number,
    filters: {
      machineTypeId?: string;
      component?: string;
      search?: string;
      active?: string;
      partsLinked?: string;
    } = {},
  ): Promise<PaginatedResponse<Panne & { recommended_parts?: PannePart[] }>> {
    const filter: FilterQuery<PanneDocument> = {};
    if (filters.machineTypeId) {
      if (!Types.ObjectId.isValid(filters.machineTypeId)) {
        throw new BadRequestException('Invalid machineTypeId');
      }
      filter.machine_type_id = new Types.ObjectId(filters.machineTypeId);
    }
    if (filters.component?.trim()) filter.component = filters.component.trim();
    if (filters.active === 'true') filter.is_active = true;
    if (filters.active === 'false') filter.is_active = false;
    if (filters.search?.trim()) {
      const expression = { $regex: filters.search.trim(), $options: 'i' };
      filter.$or = [
        { panne_id: expression },
        { code_panne: expression },
        { component: expression },
        { description: expression },
      ];
    }

    if (filters.partsLinked === 'true' || filters.partsLinked === 'false') {
      const panneIds = await this.pannePartModel.distinct('panne_id').exec();
      filter._id =
        filters.partsLinked === 'true' ? { $in: panneIds } : { $nin: panneIds };
    }

    const [items, totalItems] = await Promise.all([
      this.panneModel
        .find(filter)
        .sort({ machine_type_id: 1, code_panne: 1 })
        .skip(skip)
        .limit(limit)
        .populate('machine_type_id')
        .exec(),
      this.panneModel.countDocuments(filter).exec(),
    ]);

    const itemIds = items.map((item) => item._id);
    const links = itemIds.length
      ? await this.pannePartModel
          .find({ panne_id: { $in: itemIds } })
          .populate('part_id')
          .exec()
      : [];
    const linksByPanne = new Map<string, PannePart[]>();
    links.forEach((link) => {
      const key = link.panne_id.toString();
      linksByPanne.set(key, [...(linksByPanne.get(key) ?? []), link]);
    });

    return toPaginatedResponse(
      items.map((item) => ({
        ...item.toObject(),
        recommended_parts: linksByPanne.get(item._id.toString()) ?? [],
      })) as Array<Panne & { recommended_parts?: PannePart[] }>,
      totalItems,
      page,
      limit,
    );
  }

  async findOne(id: string): Promise<Panne | null> {
    return this.panneModel.findById(id).exec();
  }

  async update(
    id: string,
    updatePanneDto: UpdatePanneDto,
  ): Promise<Panne | null> {
    if (updatePanneDto.machine_type_id) {
      await this.assertMachineType(updatePanneDto.machine_type_id);
    }
    return this.panneModel
      .findByIdAndUpdate(id, updatePanneDto, { new: true, runValidators: true })
      .exec();
  }

  async remove(id: string): Promise<Panne | null> {
    const removed = await this.panneModel.findByIdAndDelete(id).exec();
    if (removed)
      await this.pannePartModel.deleteMany({ panne_id: removed._id }).exec();
    return removed;
  }

  async findParts(panneId: string) {
    this.assertObjectId(panneId, 'panne_id');
    return this.pannePartModel
      .find({ panne_id: new Types.ObjectId(panneId) })
      .populate('part_id')
      .sort({ priority: 1 })
      .exec();
  }

  async upsertPart(panneId: string, dto: UpsertPannePartDto) {
    this.assertObjectId(panneId, 'panne_id');
    this.assertObjectId(dto.part_id, 'part_id');
    const [panne, part] = await Promise.all([
      this.panneModel
        .findById(panneId)
        .select({ _id: 1, machine_type_id: 1 })
        .exec(),
      this.catalogueModel.findById(dto.part_id).select({ _id: 1 }).exec(),
    ]);
    if (!panne) throw new NotFoundException('Fault not found');
    if (!part) throw new NotFoundException('Part not found');
    const moduleIds = panne.machine_type_id
      ? await this.moduleTypeModel.distinct('_id', {
          type_id: panne.machine_type_id,
        })
      : [];
    const compatible = await this.modulePiecesModel.exists({
      mod_type_id: { $in: moduleIds },
      part_id: part._id,
    });
    if (!compatible) {
      throw new BadRequestException(
        'Part is not compatible with this fault machine type',
      );
    }

    return this.pannePartModel
      .findOneAndUpdate(
        { panne_id: panne._id, part_id: part._id },
        { ...dto, panne_id: panne._id, part_id: part._id },
        { new: true, upsert: true, runValidators: true },
      )
      .populate('part_id')
      .exec();
  }

  async removePart(panneId: string, partId: string) {
    this.assertObjectId(panneId, 'panne_id');
    this.assertObjectId(partId, 'part_id');
    const removed = await this.pannePartModel
      .findOneAndDelete({ panne_id: panneId, part_id: partId })
      .exec();
    if (!removed) throw new NotFoundException('Fault part link not found');
    return removed;
  }

  async findCompatibleParts(panneId: string) {
    this.assertObjectId(panneId, 'panne_id');
    const fault = await this.panneModel
      .findById(panneId)
      .select({ machine_type_id: 1 })
      .exec();
    if (!fault) throw new NotFoundException('Fault not found');
    const moduleIds = await this.moduleTypeModel.distinct('_id', {
      type_id: fault.machine_type_id,
    });
    const links = await this.modulePiecesModel
      .find({ mod_type_id: { $in: moduleIds } })
      .populate('part_id')
      .exec();
    const parts = new Map<string, unknown>();
    links.forEach((link) => {
      const part = link.part_id as unknown as { _id?: Types.ObjectId };
      if (part?._id) parts.set(part._id.toString(), part);
    });
    return [...parts.values()];
  }

  private async assertMachineType(machineTypeId: string): Promise<void> {
    this.assertObjectId(machineTypeId, 'machine_type_id');
    if (!(await this.machineTypeModel.exists({ _id: machineTypeId }))) {
      throw new NotFoundException('Machine type not found');
    }
  }

  private assertObjectId(value: string, field: string): void {
    if (!Types.ObjectId.isValid(value)) {
      throw new BadRequestException(`Invalid ${field}`);
    }
  }
}
