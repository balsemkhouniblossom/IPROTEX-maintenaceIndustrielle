import { IsIn } from 'class-validator';

export class ReviewWorkOrderDto {
  @IsIn(['return', 'intervene'])
  action: 'return' | 'intervene';
}
