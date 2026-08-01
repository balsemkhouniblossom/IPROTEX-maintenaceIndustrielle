import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class CreateCatalogueDto {
  @IsString()
  @IsNotEmpty()
  part_id: string;

  @IsString()
  @IsNotEmpty()
  nom_piece: string;

  @IsString()
  @IsNotEmpty()
  ref_constructeur: string;

  @IsString()
  @IsOptional()
  fabricant?: string;

  @IsString()
  @IsOptional()
  categorie_piece?: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  unit_cost?: number;
}
