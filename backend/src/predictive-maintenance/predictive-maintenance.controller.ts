import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  AdminOnly,
  AuthenticatedRoles,
} from '../auth/decorators/roles.decorator';
import type { AuthenticatedRequest } from '../auth/types/authenticated-request';
import { PredictiveMaintenanceService } from './predictive-maintenance.service';
import { PredictiveMaintenanceTrainingService } from './predictive-maintenance-training.service';
import { PredictionModelType } from './prediction-model.interface';

function actorFrom(req: AuthenticatedRequest) {
  return { userId: req.user!.userId!, role: req.user!.role! };
}

function assertValidModelType(type: string): PredictionModelType {
  if (
    !Object.values(PredictionModelType).includes(type as PredictionModelType)
  ) {
    throw new BadRequestException(`Unknown prediction model type: ${type}`);
  }
  return type as PredictionModelType;
}

/**
 * Every GET route here is read-only: it returns data already computed and
 * persisted by the scheduler (or a prior `/refresh` call) and never
 * derives, mutates, or triggers a side effect on a WorkOrder, Stock, or
 * Machine record. The two POST routes are clearly separated
 * infrastructure actions (recompute a reading now / retrain a model) —
 * Admin-gated for training, any authenticated role for a scoped refresh —
 * not part of the read-only prediction surface.
 */
@Controller('predictive-maintenance')
@UseGuards(JwtAuthGuard)
export class PredictiveMaintenanceController {
  constructor(
    private readonly predictiveMaintenanceService: PredictiveMaintenanceService,
    private readonly trainingService: PredictiveMaintenanceTrainingService,
  ) {}

  @Get('fleet-summary')
  @AuthenticatedRoles()
  @Throttle({ default: { limit: 300, ttl: 60000 } })
  getFleetSummary(@Req() req: AuthenticatedRequest) {
    return this.predictiveMaintenanceService.getFleetSummary(actorFrom(req));
  }

  @Get('plans-summary')
  @AuthenticatedRoles()
  @Throttle({ default: { limit: 300, ttl: 60000 } })
  getPlansSummary(@Req() req: AuthenticatedRequest) {
    return this.predictiveMaintenanceService.getPlanHealthSummaries(
      actorFrom(req),
    );
  }

  @Get('machines/:machineId')
  @AuthenticatedRoles()
  getLatestForMachine(
    @Param('machineId') machineId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.predictiveMaintenanceService.getLatestPredictions(
      machineId,
      actorFrom(req),
    );
  }

  @Get('machines/:machineId/history')
  @AuthenticatedRoles()
  getHistoryForMachine(
    @Param('machineId') machineId: string,
    @Req() req: AuthenticatedRequest,
    @Query('limit') limit?: string,
  ) {
    const parsedLimit = Number(limit);
    return this.predictiveMaintenanceService.getHistory(
      machineId,
      actorFrom(req),
      Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : undefined,
    );
  }

  @Post('machines/:machineId/refresh')
  @AuthenticatedRoles()
  refreshMachine(
    @Param('machineId') machineId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.predictiveMaintenanceService.predictForMachine(
      machineId,
      actorFrom(req),
    );
  }

  @Get('models')
  @AdminOnly()
  listModelVersions() {
    return this.trainingService.listVersions();
  }

  @Post('models/:type/train')
  @AdminOnly()
  trainModel(@Param('type') type: string, @Req() req: AuthenticatedRequest) {
    return this.trainingService.trainModel(assertValidModelType(type), {
      trainedBy: req.user!.userId,
    });
  }
}
