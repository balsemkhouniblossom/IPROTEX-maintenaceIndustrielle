import {
  IsArray,
  IsEnum,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
} from 'class-validator';
import { KnowledgeArticleCategory } from '../../schemas/knowledge-article.schema';

export class ReviseKnowledgeArticleDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsEnum(KnowledgeArticleCategory)
  category?: KnowledgeArticleCategory;

  @IsOptional()
  @IsString()
  summary?: string;

  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  @IsArray()
  tags?: string[];

  @IsOptional()
  @IsMongoId()
  machine_type_id?: string;

  @IsOptional()
  @IsMongoId()
  machine_id?: string;

  @IsOptional()
  @IsMongoId()
  maintenance_plan_id?: string;

  @IsOptional()
  @IsMongoId()
  preventive_task_id?: string;

  @IsOptional()
  @IsArray()
  fault_codes?: string[];

  @IsOptional()
  @IsArray()
  error_codes?: string[];

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsInt()
  expected_version?: number;
}
