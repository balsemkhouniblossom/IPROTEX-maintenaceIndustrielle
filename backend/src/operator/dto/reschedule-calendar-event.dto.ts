import { IsISO8601, IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * The target work order comes from the URL (:id), not the body, and there
 * is intentionally no status/technician/approval field here: identity is
 * derived from the authenticated request and ownership is verified
 * server-side before this reaches the scheduling logic.
 */
export class RescheduleCalendarEventDto {
  @IsISO8601()
  new_due_date: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}
