import { IsISO8601, IsMongoId } from 'class-validator';

/**
 * The acting operator is derived from the authenticated request, never the
 * body — see `OperatorController.schedulePreventive`'s `ensureOperator(req)`
 * call. `assertCanAccessMachine` re-verifies machine ownership server-side
 * after this DTO's shape is validated.
 */
export class SchedulePreventiveDto {
  @IsMongoId()
  machine_id: string;

  @IsMongoId()
  plan_id: string;

  @IsISO8601()
  scheduled_date: string;
}
