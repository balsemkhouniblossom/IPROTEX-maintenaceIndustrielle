import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Capteur, CapteurDocument } from '../schemas/capteur.schema';
import { Mesure, MesureDocument } from '../schemas/mesure.schema';
import { CreateCapteurDto } from './dto/create-capteur.dto';
import { UpdateCapteurDto } from './dto/update-capteur.dto';
import { PaginatedResponse, toPaginatedResponse } from '../common/pagination';
import { assertNoDependencies } from '../common/dependency-protection';

@Injectable()
export class CapteursService {
  constructor(
    @InjectModel(Capteur.name) private capteurModel: Model<CapteurDocument>,
    @InjectModel(Mesure.name) private mesureModel: Model<MesureDocument>,
  ) {}

  async findAll(
    page: number,
    limit: number,
    skip: number,
  ): Promise<PaginatedResponse<Capteur>> {
    const [items, totalItems] = await Promise.all([
      this.capteurModel.find().skip(skip).limit(limit).exec(),
      this.capteurModel.countDocuments().exec(),
    ]);

    return toPaginatedResponse(items, totalItems, page, limit);
  }

  async findOne(id: string): Promise<Capteur | null> {
    return this.capteurModel.findById(id).exec();
  }

  async create(createCapteurDto: CreateCapteurDto): Promise<Capteur> {
    const newCapteur = new this.capteurModel(createCapteurDto);
    return newCapteur.save();
  }

  async update(
    id: string,
    updateCapteurDto: UpdateCapteurDto,
  ): Promise<Capteur | null> {
    return this.capteurModel
      .findByIdAndUpdate(id, updateCapteurDto, { new: true })
      .exec();
  }

  async delete(id: string): Promise<Capteur | null> {
    await assertNoDependencies('Sensor', [
      {
        label: 'measurements',
        model: this.mesureModel,
        filter: { capteur_id: id },
      },
    ]);
    return this.capteurModel.findByIdAndDelete(id).exec();
  }
}
