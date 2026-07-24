import { PartialType } from '@nestjs/mapped-types';
import { CreateMesureDto } from './create-mesure.dto';

export class UpdateMesureDto extends PartialType(CreateMesureDto) {}
