import { IsString, MinLength } from 'class-validator';

export class RequestDeletionDto {
  /** Current password, required as re-authentication before soft-deleting. */
  @IsString()
  @MinLength(1)
  password: string;
}
