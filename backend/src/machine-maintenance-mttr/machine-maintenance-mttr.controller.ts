import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { AdminOnly } from '../auth/decorators/roles.decorator';
import type { AuthenticatedRequest } from '../auth/types/authenticated-request';
import {
  CreateMachineMaintenanceMttrDto,
  UpdateMachineMaintenanceMttrDto,
} from './dto/machine-maintenance-mttr.dto';
import { MachineMaintenanceMttrService } from './machine-maintenance-mttr.service';

@Controller('machine-maintenance-mttr')
@AdminOnly()
export class MachineMaintenanceMttrController {
  constructor(private readonly service: MachineMaintenanceMttrService) {}
  @Get() getYear(@Query('year') year?: string) {
    return this.service.getYear(year);
  }
  @Post() create(
    @Body() body: CreateMachineMaintenanceMttrDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.create(body, req.user?.userId ?? '');
  }
  @Patch(':id') update(
    @Param('id') id: string,
    @Body() body: UpdateMachineMaintenanceMttrDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.update(id, body, req.user?.userId ?? '');
  }
  @Delete(':id') remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
