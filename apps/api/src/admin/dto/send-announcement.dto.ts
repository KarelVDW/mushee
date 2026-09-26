import { Type } from 'class-transformer'
import { IsEmail, IsOptional, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator'

import { AudienceFilterDto } from './audience-filter.dto'

/**
 * A service announcement to an audience. `body` is plain text: blank lines
 * separate paragraphs, `{{name}}` becomes the recipient's first name. With
 * `testTo` set, exactly one rendered copy goes to that address and nothing to
 * the audience — the way to check a message before the real send.
 */
export class SendAnnouncementDto {
    @IsString()
    @MinLength(3)
    @MaxLength(200)
    subject: string

    @IsString()
    @MinLength(10)
    @MaxLength(20000)
    body: string

    @ValidateNested()
    @Type(() => AudienceFilterDto)
    filters: AudienceFilterDto

    @IsOptional()
    @IsEmail()
    testTo?: string
}
