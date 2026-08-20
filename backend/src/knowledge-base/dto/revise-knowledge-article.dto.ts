import { IsOptional, IsString } from 'class-validator';
import { KnowledgeArticleMutationDto } from './knowledge-article-mutation.dto';

export class ReviseKnowledgeArticleDto extends KnowledgeArticleMutationDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
