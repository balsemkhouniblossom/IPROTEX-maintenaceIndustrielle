import { PartialType } from '@nestjs/mapped-types';
import { CreateOtPieceDto } from './create-ot-piece.dto';

export class UpdateOtPieceDto extends PartialType(CreateOtPieceDto) {}
