import { IsInt, IsOptional, IsString, Min } from 'class-validator';

/**
 * Metadata only — deliberately excludes `quantite_en_stock` and
 * `quantite_reservee`. Quantity may only change through
 * `POST /stocks/:id/adjustment`, which is guarded, versioned, and logs a
 * StockMovement; a plain metadata PATCH must never be able to move
 * inventory quantities silently and untraceably.
 */
export class UpdateStockDto {
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
