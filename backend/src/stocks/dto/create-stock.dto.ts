import {
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

/**
 * No `version`/`quantite_reservee` here: a stock record created through
 * this endpoint always starts at version 1 with zero reservations, both
 * server-derived, never client-supplied. Quantity itself is only ever
 * changed afterwards through the dedicated adjustment endpoint, which
 * logs a StockMovement — this initial value is stamped once, at creation.
 */
export class CreateStockDto {
  @IsString()
  @IsNotEmpty()
  stock_id: string;

  @IsMongoId()
  part_id: string;

  @IsInt()
  @Min(0)
  quantite_en_stock: number;

  @IsInt()
  @Min(0)
  @IsOptional()
  seuil_alerte_stock?: number;

  @IsInt()
  @Min(0)
  @IsOptional()
  quantite_minimale?: number;

  @IsString()
  @IsOptional()
  emplacement?: string;
}
