import { OmitType, PartialType } from '@nestjs/mapped-types';
import { IsInt, IsOptional } from 'class-validator';
import { CreateDocumentDto } from './create-document.dto';

/**
 * `uploaded_by` is deliberately excluded — it's set once, server-side, at
 * creation time (see `DocumentsController.create`, which overrides
 * whatever the client sends with the authenticated uploader's id) and must
 * never be retroactively editable, or an Admin could forge who originally
 * uploaded a document in the audit trail.
 */
export class UpdateDocumentDto extends PartialType(
  OmitType(CreateDocumentDto, ['uploaded_by'] as const),
) {
  @IsOptional()
  @IsInt()
  expected_version?: number;
}
