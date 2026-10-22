import { BadRequestException } from '@nestjs/common'
import { Type } from 'class-transformer'
import { IsArray, IsBoolean, IsIn, IsInt, IsISO8601, isISO8601, IsOptional, IsString, Max, Min } from 'class-validator'

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
    @IsBoolean()
    verifiedOnly?: boolean

    /** Include accounts with a pending deletion request (default false). */
    @IsOptional()
    @IsBoolean()
    includeDeletionRequested?: boolean

    /**
     * Query-string form: tiers comma-separated, booleans as "true". The GET
     * routes take `@Query()` as a plain record, which the global ValidationPipe
     * skips, so this is where that form is checked. Unknown beta statuses and
     * bad day counts are dropped, but a malformed date is rejected: dropping it
     * would widen the previewed audience past what the (validated) send reaches.
     */
    static fromQuery(query: Record<string, string | undefined>): AudienceFilterDto {
        const filters = new AudienceFilterDto()
        if (query.tiers)
            filters.tiers = query.tiers
                .split(',')
                .map((t) => t.trim())
                .filter(Boolean)
        if (query.betaStatus && (BETA_STATUS_FILTERS as readonly string[]).includes(query.betaStatus))
            filters.betaStatus = query.betaStatus as BetaStatusFilter
        for (const key of ['signedUpAfter', 'signedUpBefore'] as const) {
            const value = query[key]
            if (!value) continue
            if (!isISO8601(value)) throw new BadRequestException(`${key} must be an ISO 8601 date`)
            filters[key] = value
        }
        if (query.activeWithinDays) {
            const days = Number(query.activeWithinDays)
            if (Number.isInteger(days) && days > 0) filters.activeWithinDays = days
        }
        filters.verifiedOnly = query.verifiedOnly === 'true'
        filters.includeDeletionRequested = query.includeDeletionRequested === 'true'
        return filters
    }
}
