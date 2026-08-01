import { Transform, TransformFnParams } from 'class-transformer';
import { IsISO8601, IsNotEmpty, IsString, MaxLength } from 'class-validator';

function trimIfString({ value }: TransformFnParams): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

/**
 * Mirrors operator/dto/reschedule-calendar-event.dto.ts — same fields, same
 * bounds. The target work order comes from the URL (:id); the acting user
 * is derived from the authenticated request, never the body. `reason` is
 * trimmed before validation so a whitespace-only value is rejected by
 * @IsNotEmpty rather than silently accepted.
 */
export class RescheduleWorkOrderDto {
  @IsISO8601()
  new_due_date: string;

  @Transform(trimIfString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}
