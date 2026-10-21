import 'reflect-metadata'

import type { DataSource } from 'typeorm'
import { describe, expect, it, vi } from 'vitest'

import { BetaService } from '../../src/beta/beta.service'
import type { MailService } from '../../src/mail/mail.service'
import type { ErrorReporter } from '../../src/telemetry/error-reporter'

/**
 * The fake mirrors the postgres driver's raw-query contract, which is the
 * part that bit us in production: SELECT resolves to plain rows, but
 * UPDATE … RETURNING resolves to a [rows, affectedRowCount] tuple.
 */
function makeService(updateReturning: Array<{ email: string; name: string }>) {
    const dataSource = {
        query: vi.fn((sql: string) =>
            Promise.resolve(sql.trimStart().startsWith('UPDATE') ? [updateReturning, updateReturning.length] : []),
        ),
    }
    const mailService = {
        sendBetaApprovedEmail: vi.fn(() => Promise.resolve()),
    }
    const reporter = { capture: vi.fn() }
    const service = new BetaService(
        dataSource as unknown as DataSource,
        mailService as unknown as MailService,
        reporter as unknown as ErrorReporter,
    )
    return { service, dataSource, mailService, reporter }
}

describe('BetaService.approve', () => {
    it('emails the approved user with their real address and name', async () => {
        const { service, mailService } = makeService([{ email: 'ada@example.com', name: 'Ada' }])

        await service.approve('user-1')

        expect(mailService.sendBetaApprovedEmail).toHaveBeenCalledWith('ada@example.com', 'Ada')
    })

    it('sends nothing when the user was not pending (0 rows updated)', async () => {
        const { service, mailService } = makeService([])

        await service.approve('user-1')

        expect(mailService.sendBetaApprovedEmail).not.toHaveBeenCalled()
    })

    it('still returns the signup list when the approval email fails, and reports the failure', async () => {
        const { service, mailService, reporter } = makeService([{ email: 'ada@example.com', name: 'Ada' }])
        const failure = new Error('SendGrid down')
        mailService.sendBetaApprovedEmail.mockRejectedValueOnce(failure)

        await expect(service.approve('user-1')).resolves.toEqual([])
        expect(reporter.capture).toHaveBeenCalledTimes(1)
        expect(reporter.capture).toHaveBeenCalledWith(failure, { origin: 'beta', job: 'approval-email', userId: 'user-1' })
    })
})
