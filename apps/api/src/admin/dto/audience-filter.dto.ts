import { Type } from 'class-transformer'
import { IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsOptional, IsString, Max, Min } from 'class-validator'

export const BETA_STATUS_FILTERS = ['any', 'pending', 'approved', 'none'] as const
export type BetaStatusFilter = (typeof BETA_STATUS_FILTERS)[number]

/**
 * Who an announcement (or an export) goes to. Every field is optional and
 * narrows the set; no fields = every account. Accounts that asked for deletion
 * are left out unless explicitly included.
 */
export class AudienceFilterDto {
    /** Subscription tier ids (e.g. ['beta'], ['free', 'pro']); empty/absent = all tiers. */
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    tiers?: string[]

    /** 'pending' / 'approved' beta accounts, 'none' for accounts without a beta status, 'any' (default). */
    @IsOptional()
    @IsIn(BETA_STATUS_FILTERS)
    betaStatus?: BetaStatusFilter

    /** Signed up at or after this instant (ISO 8601). */
    @IsOptional()
    @IsISO8601()
    signedUpAfter?: string

    /** Signed up before this instant (ISO 8601). */
    @IsOptional()
    @IsISO8601()
    signedUpBefore?: string

    /** Had a session touched within the last N days. */
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(3650)
    activeWithinDays?: number

    /** Only accounts whose e-mail address is verified (default false = everyone). */
    @IsOptional()
    @Type(() => Boolean)
    @IsBoolean()
    verifiedOnly?: boolean

    /** Include accounts with a pending deletion request (default false). */
    @IsOptional()
    @Type(() => Boolean)
    @IsBoolean()
    includeDeletionRequested?: boolean
}
