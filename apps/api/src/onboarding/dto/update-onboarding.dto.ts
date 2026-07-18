import {
  IsArray,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

// Survey answer keys — must match the options the onboarding wizard offers
// (apps/web/src/app/onboarding/onboarding-data.ts). Keeping the value space
// closed keeps analytics segments clean; instruments stay free strings since
// they mirror the web's instrument model list.
export const ONBOARDING_BACKGROUNDS = [
  'curious',
  'hobbyist',
  'student',
  'teacher',
  'composer',
  'professional',
] as const;

export const ONBOARDING_GOALS = [
  'transcribe',
  'compose',
  'arrange',
  'teach',
  'learn',
] as const;

export const ONBOARDING_SOURCES = [
  'friend',
  'search',
  'social',
  'youtube',
  'teacher',
  'blog',
  'other',
] as const;

export class UpdateOnboardingDto {
  @IsOptional()
  @IsIn(ONBOARDING_BACKGROUNDS)
  background?: string;

  @IsOptional()
  @IsIn(ONBOARDING_GOALS)
  goal?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  instruments?: string[];

  @IsOptional()
  @IsIn(ONBOARDING_SOURCES)
  source?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  sourceDetail?: string;

  @IsOptional()
  @IsISO8601()
  completedAt?: string;
}
