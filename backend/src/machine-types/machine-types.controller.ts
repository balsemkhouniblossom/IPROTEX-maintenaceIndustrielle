import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
} from '@nestjs/common';
import { MachineTypesService } from './machine-types.service';
import { CreateMachineTypeDto } from './dto/create-machine-type.dto';
import { UpdateMachineTypeDto } from './dto/update-machine-type.dto';
import { normalizePagination, PaginatedResponse } from '../common/pagination';
import {
  AdminOnly,
  AuthenticatedRoles,
} from '../auth/decorators/roles.decorator';
import { MachineTypeResponse } from './contracts/machine-type-response.types';
@Controller('machine-types')
@AuthenticatedRoles()
export class MachineTypesController {
  constructor(private readonly machineTypesService: MachineTypesService) {}

  @Post()
  @AdminOnly()
  create(
    @Body() createMachineTypeDto: CreateMachineTypeDto,
  ): Promise<MachineTypeResponse> {
    return this.machineTypesService.create(createMachineTypeDto);
  }

  @Get()
  @AdminOnly()
  findAll(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ): Promise<PaginatedResponse<MachineTypeResponse>> {
    const pagination = normalizePagination(page, limit);

    return this.machineTypesService.findAll(
      pagination.page,
      pagination.limit,
      pagination.skip,
    );
  }

  @Get(':id')
  @AdminOnly()
  findOne(@Param('id') id: string): Promise<MachineTypeResponse | null> {
    return this.machineTypesService.findOne(id);
  }

  @Patch(':id')
  @AdminOnly()
  update(
    @Param('id') id: string,
    @Body() updateMachineTypeDto: UpdateMachineTypeDto,
  ): Promise<MachineTypeResponse | null> {
    return this.machineTypesService.update(id, updateMachineTypeDto);
  }

  @Delete(':id')
  @AdminOnly()
  remove(@Param('id') id: string): Promise<MachineTypeResponse | null> {
    return this.machineTypesService.remove(id);
  }
}
