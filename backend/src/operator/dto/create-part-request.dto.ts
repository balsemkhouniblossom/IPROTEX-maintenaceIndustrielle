import { IsInt, IsMongoId, IsPositive } from 'class-validator';

/**
 * The target work order comes from the URL (:id), not the body, and there is
 * intentionally no requester/status/stock/approval field here: identity is
 * derived from the authenticated request, the request always starts
 * `pending`, and it never carries a stock quantity — the global
 * ValidationPipe (whitelist + forbidNonWhitelisted) rejects any request that
 * tries to smuggle one of those in alongside this DTO.
 */
export class CreatePartRequestDto {
  @IsMongoId()
  part_id: string;

  @IsInt()
  @IsPositive()
  quantity: number;
}
