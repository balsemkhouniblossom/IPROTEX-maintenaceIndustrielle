import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { DocumentAccessService } from '../documents/document-access.service';
import { Role } from '../schemas/user.schema';
import {
  MttrSourceResult,
  MttrSourceService,
} from '../kpi/mttr-source.service';

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly mttrSource: MttrSourceService,
    private readonly documentAccessService: DocumentAccessService,
  ) {}

  async getMttr(
    year: number,
    filters: {
      machineId?: string;
      technicianId?: string;
      machineTypeId?: string;
      faultCode?: string;
      component?: string;
      actor: { userId: string; role: Role };
    },
  ): Promise<MttrSourceResult> {
    if (!Number.isFinite(year) || year < 2000 || year > 2100) {
      throw new BadRequestException('Invalid year');
    }

    if (filters.technicianId && !Types.ObjectId.isValid(filters.technicianId)) {
      throw new BadRequestException('Invalid technicianId');
    }
    if (
      filters.machineTypeId &&
      !Types.ObjectId.isValid(filters.machineTypeId)
    ) {
      throw new BadRequestException('Invalid machineTypeId');
    }
    if (
      filters.technicianId &&
      filters.actor.role !== Role.ADMIN &&
      filters.technicianId !== filters.actor.userId
    ) {
      throw new ForbiddenException(
        'Non-admin users may filter MTTR only by their own technician record',
      );
    }

    let machineIds: string[] | undefined;
    if (filters.machineId) {
      if (!Types.ObjectId.isValid(filters.machineId)) {
        throw new BadRequestException('Invalid machineId');
      }
      await this.documentAccessService.assertCanAccessMachine(
        { userId: filters.actor.userId, role: filters.actor.role },
        filters.machineId,
      );
      machineIds = [filters.machineId];
    } else if (filters.actor.role !== Role.ADMIN) {
      machineIds = (
        await this.documentAccessService.listAccessibleMachineIds({
          userId: filters.actor.userId,
          role: filters.actor.role,
        })
      )?.map((id) => id.toHexString());
      if (!machineIds?.length) {
        throw new ForbiddenException('No accessible machines for this report');
      }
    }

    return this.mttrSource.calculate({
      year,
      machineIds,
      technicianId: filters.technicianId,
      machineTypeId: filters.machineTypeId,
      faultCode: filters.faultCode?.trim() || undefined,
      component: filters.component?.trim() || undefined,
    });
  }
}
