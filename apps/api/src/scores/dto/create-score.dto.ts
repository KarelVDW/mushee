import { IsObject, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateScoreDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title: string;

  @IsObject()
  score: Record<string, unknown>;
}
