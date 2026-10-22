import { Type } from 'class-transformer'
import { IsIn, IsInt, IsNumber, IsOptional, IsPositive, IsString, MaxLength, Min, ValidateNested } from 'class-validator'

import type { RecordingMeta } from '../pipeline/recording-pipeline'

class TimeSignatureDto {
    @IsInt()
    @Min(1)
    beats: number

    @IsInt()
    @Min(1)
    beatType: number
}

/**
 * The fields of the client's `{ type: 'meta', ... }` text frame, validated like
 * every HTTP body is (the field docs live on `RecordingMeta`). The socket
 * bypasses Nest's ValidationPipe, so the gateway runs this itself and drops a
 * frame that fails it.
 */
export class RecordingMetaDto implements RecordingMeta {
    @IsOptional()
    @IsNumber()
    @IsPositive()
    bpm?: number

    @IsOptional()
    @ValidateNested()
    @Type(() => TimeSignatureDto)
    timeSignature?: TimeSignatureDto | null

    @IsOptional()
    @IsNumber()
    chromaticTranspose?: number

    @IsOptional()
    @IsString()
    @MaxLength(64)
    instrumentId?: string

    @IsOptional()
    @IsIn(['voice', 'instrument'])
    sourceKind?: 'voice' | 'instrument' | null

    @IsOptional()
    @IsNumber()
    keyFifths?: number | null

    @IsOptional()
    @IsString()
    @MaxLength(128)
    mimeType?: string | null
}
