import { IsInt, IsMongoId, Min } from 'class-validator';

export class CreateModulePieceDto {
  @IsMongoId()
  mod_type_id!: string;

  @IsMongoId()
  part_id!: string;

  @IsInt()
  @Min(1)
  quantite_standard!: number;
}
