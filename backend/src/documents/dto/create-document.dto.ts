import { IsArray, IsMongoId, IsOptional, IsString } from 'class-validator';

export class CreateDocumentDto {
  @IsString()
  document_id: string;

  @IsString()
  machine_id: string;

  @IsOptional()
  @IsMongoId()
  maintenance_plan_id?: string;

  @IsOptional()
  @IsMongoId()
  work_order_id?: string;

  @IsOptional()
  @IsMongoId()
  intervention_report_id?: string;

  @IsString()
  type_document: string;

  @IsString()
  file_path: string;

  @IsOptional()
  @IsString()
  storage_path?: string;

  @IsOptional()
  @IsString()
  file_url?: string;

  @IsString()
  file_name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsArray()
  tags?: string[];

  @IsOptional()
  @IsString()
  uploaded_by?: string;
}
