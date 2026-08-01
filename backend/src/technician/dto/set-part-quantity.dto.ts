import { IsInt, IsMongoId, Min } from 'class-validator';

export class SetPartQuantityDto {
  @IsMongoId()
  partId: string;

  @IsInt()
  @Min(1)
  quantity: number;
}
