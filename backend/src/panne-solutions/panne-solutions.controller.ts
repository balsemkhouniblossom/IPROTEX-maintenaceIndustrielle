import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { PanneSolutionsService } from './panne-solutions.service';
import { CreatePanneSolutionDto } from './dto/create-panne-solution.dto';
import { UpdatePanneSolutionDto } from './dto/update-panne-solution.dto';
import { normalizePagination } from '../common/pagination';
import {
  AdminOnly,
  AuthenticatedRoles,
} from '../auth/decorators/roles.decorator';

@Controller('panne-solutions')
@AuthenticatedRoles()
export class PanneSolutionsController {
  constructor(private readonly panneSolutionsService: PanneSolutionsService) {}

  @Post()
  @AdminOnly()
  create(@Body() createPanneSolutionDto: CreatePanneSolutionDto) {
    return this.panneSolutionsService.create(createPanneSolutionDto);
  }

  @Get()
  @AdminOnly()
  findAll(@Query('page') page?: string, @Query('limit') limit?: string) {
    const pagination = normalizePagination(page, limit);
    return this.panneSolutionsService.findAll(
      pagination.page,
      pagination.limit,
      pagination.skip,
    );
  }

  @Get(':id')
  @AdminOnly()
  findOne(@Param('id') id: string) {
    return this.panneSolutionsService.findOne(id);
  }

  @Patch(':id')
  @AdminOnly()
  update(
    @Param('id') id: string,
    @Body() updatePanneSolutionDto: UpdatePanneSolutionDto,
  ) {
    return this.panneSolutionsService.update(id, updatePanneSolutionDto);
  }

  @Delete(':id')
  @AdminOnly()
  remove(@Param('id') id: string) {
    return this.panneSolutionsService.remove(id);
  }
}
