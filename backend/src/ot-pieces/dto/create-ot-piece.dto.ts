import { IsInt, IsMongoId, Min } from 'class-validator';

export class CreateOtPieceDto {
  @IsMongoId()
  ot_id: string;

  @IsMongoId()
  part_id: string;

  @IsInt()
  @Min(1)
  quantite: number;
}
