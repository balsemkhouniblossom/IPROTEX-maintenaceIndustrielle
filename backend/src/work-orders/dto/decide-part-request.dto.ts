import { IsIn, IsOptional, IsString } from 'class-validator';

/**
 * The target part request comes from the URL (:id), not the body, and there
 * is intentionally no requester/status field here: the decider's identity
 * is derived from the authenticated request and the resulting status is
 * always computed server-side from `action`. `reason` is only meaningful
 * for `cancel` (releasing a reservation that will not be consumed after
 * all) and is otherwise ignored.
 */
export class DecidePartRequestDto {
  @IsIn(['approve', 'reject', 'cancel'])
  action: 'approve' | 'reject' | 'cancel';

  @IsOptional()
  @IsString()
  reason?: string;
}
