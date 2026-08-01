import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Device, DeviceDocument } from '../schemas/device.schema';
import { Machine, MachineDocument } from '../schemas/machine.schema';
import { DeviceAuthService, GeneratedDeviceKey } from './device-auth.service';
import { RegisterDeviceDto } from './dto/register-device.dto';
import { UpdateDeviceDto } from './dto/update-device.dto';

export interface RegisteredDevice {
  device: DeviceDocument;
  /** Only ever returned once, at registration or rotation time. */
  apiKey: string;
}

@Injectable()
export class DevicesService {
  constructor(
    @InjectModel(Device.name)
    private readonly deviceModel: Model<DeviceDocument>,
    @InjectModel(Machine.name)
    private readonly machineModel: Model<MachineDocument>,
    private readonly deviceAuthService: DeviceAuthService,
  ) {}

  async register(
    dto: RegisterDeviceDto,
    actorId?: string,
  ): Promise<RegisteredDevice> {
    const machineExists = await this.machineModel
      .exists({ _id: dto.machine_id })
      .exec();
    if (!machineExists) {
      throw new BadRequestException('Referenced machine does not exist');
    }

    const generated: GeneratedDeviceKey =
      await this.deviceAuthService.generateApiKey();

    try {
      const device = await this.deviceModel.create({
        device_id: dto.device_id,
        machine_id: dto.machine_id,
        label: dto.label,
        device_type: dto.device_type,
        heartbeat_interval_seconds: dto.heartbeat_interval_seconds ?? 30,
        api_key_hash: generated.keyHash,
        key_prefix: generated.keyPrefix,
        created_by: actorId,
        key_rotated_at: new Date(),
      });
      return { device, apiKey: generated.rawKey };
    } catch (error) {
      if (this.isDuplicateKeyError(error)) {
        throw new ConflictException(
          `A device with device_id "${dto.device_id}" already exists`,
        );
      }
      throw error;
    }
  }

  async findAll(): Promise<DeviceDocument[]> {
    return this.deviceModel.find().sort({ createdAt: -1 }).exec();
  }

  async findOne(id: string): Promise<DeviceDocument> {
    if (!Types.ObjectId.isValid(id))
      throw new BadRequestException('Invalid device id');
    const device = await this.deviceModel.findById(id).exec();
    if (!device) throw new NotFoundException('Device not found');
    return device;
  }

  async update(id: string, dto: UpdateDeviceDto): Promise<DeviceDocument> {
    const device = await this.findOne(id);
    if (dto.label !== undefined) device.label = dto.label;
    if (dto.is_active !== undefined) device.is_active = dto.is_active;
    if (dto.heartbeat_interval_seconds !== undefined) {
      device.heartbeat_interval_seconds = dto.heartbeat_interval_seconds;
    }
    await device.save();
    return device;
  }

  async rotateKey(id: string): Promise<RegisteredDevice> {
    const device = await this.findOne(id);
    const generated = await this.deviceAuthService.generateApiKey();
    device.api_key_hash = generated.keyHash;
    device.key_prefix = generated.keyPrefix;
    device.key_rotated_at = new Date();
    await device.save();
    return { device, apiKey: generated.rawKey };
  }

  async remove(id: string): Promise<void> {
    const deleted = await this.deviceModel.findByIdAndDelete(id).exec();
    if (!deleted) throw new NotFoundException('Device not found');
  }

  private isDuplicateKeyError(error: unknown): boolean {
    return Boolean(
      error &&
      typeof error === 'object' &&
      (error as { code?: number }).code === 11000,
    );
  }
}
