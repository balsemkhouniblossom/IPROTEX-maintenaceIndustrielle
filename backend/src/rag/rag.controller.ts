import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Throttle } from '@nestjs/throttler';
import {
  AdminOnly,
  AuthenticatedRoles,
} from '../auth/decorators/roles.decorator';
import { DocumentIngestionService } from './services/document-ingestion.service';

@Controller('rag')
@UseGuards(JwtAuthGuard)
@AuthenticatedRoles()
@AdminOnly()
export class RagController {
  constructor(private readonly ingestion: DocumentIngestionService) {}

  /** Read-only operational evidence for Admin release checks. */
  @Get('readiness')
  readiness() {
    return this.ingestion.getReadiness();
  }

  @Post('documents/:id/index')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  index(@Param('id') id: string) {
    return this.ingestion.indexDocument(id, { force: true });
  }
}
