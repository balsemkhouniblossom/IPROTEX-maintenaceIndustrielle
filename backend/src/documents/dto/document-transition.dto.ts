import { IsInt, IsOptional, IsString } from 'class-validator';

/**
 * Shared by the publish and archive endpoints: the target document comes
 * from the URL (:id), and the resulting status is always computed
 * server-side from which endpoint was called — there is no `action` field
 * to smuggle a different transition through.
 */
export class DocumentTransitionDto {
  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsInt()
  expected_version?: number;
}
