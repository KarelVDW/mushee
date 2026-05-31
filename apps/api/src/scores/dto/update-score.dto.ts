import {
  IsArray,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class UpdateScoreDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsObject()
  measures?: Record<string, Record<string, unknown>>;

  @IsOptional()
  @IsArray()
  allMeasures?: Record<string, unknown>[];

  @IsOptional()
  @IsObject()
  partList?: Record<string, unknown>;
}
