import { IsString, MaxLength } from 'class-validator'

/** Subject + body to render exactly as recipients will see it (no send). */
export class PreviewAnnouncementDto {
    @IsString()
    @MaxLength(200)
    subject: string

    @IsString()
    @MaxLength(20000)
    body: string
}
