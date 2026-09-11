import { Controller, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
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

  @Post('documents/:id/index')
  index(@Param('id') id: string) {
    return this.ingestion.indexDocument(id, { force: true });
  }
}
