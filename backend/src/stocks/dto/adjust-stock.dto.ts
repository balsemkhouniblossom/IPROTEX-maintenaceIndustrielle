import { IsInt, IsNotEmpty, IsOptional, IsString, NotEquals } from 'class-validator';

/**
 * The only field that can ever move `quantite_en_stock` outside of an
 * approved-work-order flow. `expected_version` is optional in the DTO
 * shape (a fresh stock record with no prior adjustment has no version to
 * match yet) but `StockMovementsService.adjust` requires it the moment the
 * record actually has a version — the same escape-hatch pattern used for
 * MaintenancePlan edits.
 */
export class AdjustStockDto {
  @IsInt()
  @NotEquals(0)
  delta: number;

  @IsString()
  @IsNotEmpty()
  reason: string;

  @IsInt()
  @IsOptional()
  expected_version?: number;
}
