import { PartialType } from '@nestjs/mapped-types';
import { CreateLubrificationLogDto } from './create-lubrification-log.dto';

export class UpdateLubrificationLogDto extends PartialType(
  CreateLubrificationLogDto,
) {}
