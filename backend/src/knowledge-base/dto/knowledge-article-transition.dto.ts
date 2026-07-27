import { IsInt, IsOptional, IsString } from 'class-validator';

export class KnowledgeArticleTransitionDto {
  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsInt()
  expected_version?: number;
}
