import { Controller, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthenticatedRoles, Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../schemas/user.schema';
import { DocumentIngestionService } from './services/document-ingestion.service';

@Controller('rag')
@UseGuards(JwtAuthGuard)
@AuthenticatedRoles()
@Roles(Role.ADMIN)
export class RagController {
  constructor(private readonly ingestion: DocumentIngestionService) {}

  @Post('documents/:id/index')
  index(@Param('id') id: string) {
    return this.ingestion.indexDocument(id);
  }
}

