import { Type } from 'class-transformer';
import {
  IsDefined,
  IsObject,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

import { ScorePartwiseDto } from './mxml.dto';

export class CreateScoreDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title: string;

  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => ScorePartwiseDto)
  score: ScorePartwiseDto;
}
