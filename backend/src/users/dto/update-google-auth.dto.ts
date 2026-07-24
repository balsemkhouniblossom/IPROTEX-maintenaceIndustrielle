import { IsNotEmpty, IsString } from 'class-validator';

export class UpdateGoogleAuthDto {
  @IsString()
  @IsNotEmpty()
  google_id: string;
}
