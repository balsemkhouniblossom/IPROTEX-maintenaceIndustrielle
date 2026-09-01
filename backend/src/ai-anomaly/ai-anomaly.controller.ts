import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { AuthenticatedRoles, Roles } from '../auth/decorators/roles.decorator';
import { AuthenticatedRequest } from '../auth/types/authenticated-request';
import { Role } from '../schemas/user.schema';
import { AiAnomalyService } from './ai-anomaly.service';
import {
  AiAnomalyQueryDto,
  CreateAiAnomalyAnalysisDto,
  CreateAiAnomalyBatchDto,
  ValidateAiAnomalyAnalysisDto,
} from './dto/ai-anomaly.dto';
import { AiAnomalyActor } from './ai-anomaly.types';

@Controller('ai-anomaly')
export class AiAnomalyController {
  constructor(private readonly aiAnomalyService: AiAnomalyService) {}

  @Get('models')
  @Roles(Role.ADMIN, Role.TECHNICIAN)
  getModels() {
    return this.aiAnomalyService.getModelMetadata();
  }

  @Post('analyses')
  @AuthenticatedRoles()
  createAnalysis(
    @Body() dto: CreateAiAnomalyAnalysisDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.aiAnomalyService.createAnalysis(dto, this.actorFrom(req));
  }

  @Post('analyses/batch')
  @AuthenticatedRoles()
  createBatch(
    @Body() dto: CreateAiAnomalyBatchDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.aiAnomalyService.createBatch(dto, this.actorFrom(req));
  }

  @Get('analyses')
  @Roles(Role.ADMIN, Role.TECHNICIAN)
  listAnalyses(
    @Query() query: AiAnomalyQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.aiAnomalyService.listAnalyses(query, this.actorFrom(req));
  }

  @Get('analyses/:id')
  @Roles(Role.ADMIN, Role.TECHNICIAN)
  getAnalysis(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.aiAnomalyService.getAnalysis(id, this.actorFrom(req));
  }

  @Get('machines/:machineId/history')
  @Roles(Role.ADMIN, Role.TECHNICIAN)
  getMachineHistory(
    @Param('machineId') machineId: string,
    @Query() query: AiAnomalyQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.aiAnomalyService.getMachineHistory(
      machineId,
      query,
      this.actorFrom(req),
    );
  }

  @Patch('analyses/:id/validation')
  @Roles(Role.ADMIN, Role.TECHNICIAN)
  validateAnalysis(
    @Param('id') id: string,
    @Body() dto: ValidateAiAnomalyAnalysisDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.aiAnomalyService.validateAnalysis(id, dto, this.actorFrom(req));
  }

  private actorFrom(req: AuthenticatedRequest): AiAnomalyActor {
    return {
      userId: req.user?.userId ?? '',
      role: req.user?.role as Role,
    };
  }
}
