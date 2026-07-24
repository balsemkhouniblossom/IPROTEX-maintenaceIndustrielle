import { PartialType } from '@nestjs/mapped-types';
import { CreateModulePieceDto } from './create-module-piece.dto';

export class UpdateModulePieceDto extends PartialType(CreateModulePieceDto) {}
