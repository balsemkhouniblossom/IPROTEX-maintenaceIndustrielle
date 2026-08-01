import { IsIn, IsOptional } from 'class-validator';

export class ValidateWorkOrderDto {
  @IsOptional()
  @IsIn(['approve', 'reject', 'request_correction'])
  action?: 'approve' | 'reject' | 'request_correction';
}
