import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

import { IsMeasureRecord } from './measure-record.validator';
import { MxmlMeasureDto, MxmlPartListDto } from './mxml.dto';

export class UpdateScoreDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  /** Partial update: measure index → serialized measure. */
  @IsOptional()
  @IsMeasureRecord()
  measures?: Record<string, MxmlMeasureDto>;

  /** Full replacement of all measures (structural changes). */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10000)
  @ValidateNested({ each: true })
  @Type(() => MxmlMeasureDto)
  allMeasures?: MxmlMeasureDto[];

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => MxmlPartListDto)
  partList?: MxmlPartListDto;
}
