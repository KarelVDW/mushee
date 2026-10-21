import { Global, Module } from '@nestjs/common'

import { MailService, mailService } from './mail.service'

@Global()
@Module({
    // The module-level singleton, not a second instance: auth.config.ts sends
    // auth emails through the same object outside DI.
    providers: [{ provide: MailService, useValue: mailService }],
    exports: [MailService],
})
export class MailModule {}
