import {
  IsArray,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class UpdateOnboardingDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  background?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  instruments?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(100)
  source?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  sourceDetail?: string;

  @IsOptional()
  @IsISO8601()
  completedAt?: string;
}
