import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  AdminOnly,
  AuthenticatedRoles,
} from '../auth/decorators/roles.decorator';
import type { AuthenticatedRequest } from '../auth/types/authenticated-request';
import { AiAssistantService } from './ai-assistant.service';
import { RequestAiRecommendationDto } from './dto/request-ai-recommendation.dto';

@Controller('ai-assistant')
@UseGuards(JwtAuthGuard)
export class AiAssistantController {
  constructor(private readonly aiAssistantService: AiAssistantService) {}

  @Post('recommendations')
  @AuthenticatedRoles()
  requestRecommendation(
    @Body() dto: RequestAiRecommendationDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.aiAssistantService.getRecommendation(
      { userId: req.user!.userId!, role: req.user!.role! },
      dto,
    );
  }

  /** Caller's own interaction history — every role may audit their own use. */
  @Get('history')
  @AuthenticatedRoles()
  getOwnHistory(@Req() req: AuthenticatedRequest) {
    return this.aiAssistantService.listOwnHistory({
      userId: req.user!.userId!,
    });
  }

  /** Full interaction history across all users — Admin audit view. */
  @Get('history/all')
  @AdminOnly()
  getAllHistory() {
    return this.aiAssistantService.listAllHistory();
  }

  /** Provider/config diagnostics only; never returns API keys or prompt data. */
  @Get('health')
  @AdminOnly()
  getHealth() {
    return this.aiAssistantService.getHealth();
  }
}
