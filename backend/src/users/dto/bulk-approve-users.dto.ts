import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsMongoId,
} from 'class-validator';

const MAX_BULK_SIZE = 200;

export class BulkApproveUsersDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_BULK_SIZE)
  @IsMongoId({ each: true })
  userIds: string[];
}
