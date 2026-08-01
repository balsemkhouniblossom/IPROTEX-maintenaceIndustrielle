import { PartialType } from '@nestjs/mapped-types';
import { CreateLubrifiantDto } from './create-lubrifiant.dto';

export class UpdateLubrifiantDto extends PartialType(CreateLubrifiantDto) {}
