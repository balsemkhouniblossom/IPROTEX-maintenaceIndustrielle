import { IsString, MinLength } from 'class-validator';

export class GoogleLoginExchangeDto {
  @IsString()
  @MinLength(16)
  code: string;
}
