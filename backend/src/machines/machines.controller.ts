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
import { MachinesService } from './machines.service';
import { CreateMachineDto } from './dto/create-machine.dto';
import { UpdateMachineDto } from './dto/update-machine.dto';
import { normalizePagination, PaginatedResponse } from '../common/pagination';
import {
  AdminOnly,
  AuthenticatedRoles,
} from '../auth/decorators/roles.decorator';
import { MachineResponse } from './contracts/machine-response.types';

@Controller('machines')
@AuthenticatedRoles()
export class MachinesController {
  constructor(private readonly machinesService: MachinesService) {}

  @Post()
  @AdminOnly()
  create(@Body() createMachineDto: CreateMachineDto): Promise<MachineResponse> {
    return this.machinesService.create(createMachineDto);
  }
  @Get('total')
  @AdminOnly()
  countTotal(): Promise<number> {
    return this.machinesService.countAll();
  }
  @Get()
  @AdminOnly()
  findAll(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ): Promise<PaginatedResponse<MachineResponse>> {
    const pagination = normalizePagination(page, limit);
    return this.machinesService.findAll(
      pagination.page,
      pagination.limit,
      pagination.skip,
    );
  }

  @Get(':id')
  @AdminOnly()
  findOne(@Param('id') id: string): Promise<MachineResponse | null> {
    return this.machinesService.findOne(id);
  }

  @Patch(':id')
  @AdminOnly()
  update(
    @Param('id') id: string,
    @Body() updateMachineDto: UpdateMachineDto,
  ): Promise<MachineResponse | null> {
    return this.machinesService.update(id, updateMachineDto);
  }

  @Delete(':id')
  @AdminOnly()
  remove(@Param('id') id: string): Promise<MachineResponse | null> {
    return this.machinesService.remove(id);
  }
}
