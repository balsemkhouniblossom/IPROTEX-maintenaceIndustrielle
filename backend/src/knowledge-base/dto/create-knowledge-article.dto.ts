import {
  IsArray,
  IsEnum,
  IsMongoId,
  IsOptional,
  IsString,
} from 'class-validator';
import { KnowledgeArticleCategory } from '../../schemas/knowledge-article.schema';

export class CreateKnowledgeArticleDto {
  @IsString()
  article_id: string;

  @IsString()
  title: string;

  @IsEnum(KnowledgeArticleCategory)
  category: KnowledgeArticleCategory;

  @IsOptional()
  @IsString()
  summary?: string;

  @IsString()
  content: string;

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
}
