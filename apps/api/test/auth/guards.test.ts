import type { ExecutionContext } from '@nestjs/common'
import { ForbiddenException, UnauthorizedException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AuthGuard } from '../../src/auth/auth.guard'
import type { BetaService } from '../../src/beta/beta.service'
import { BetaApprovalGuard } from '../../src/beta/beta-approval.guard'

// The real auth.config builds a better-auth instance backed by a pg Pool at
// import time. AuthGuard only needs getSession; BetaApprovalGuard only needs
// BetaService (faked per test below).
const getSession = vi.fn()
vi.mock('../../src/auth/auth.config', () => ({
    auth: {
        api: {
            get getSession() {
                return getSession
            },
        },
    },
}))

function contextFor(request: Record<string, unknown>): ExecutionContext {
    return {
        switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext
}

const session = {
    user: { id: 'u1', email: 'a@b.c', role: 'user' },
    session: { id: 's1' },
}

beforeEach(() => {
    getSession.mockReset()
})

describe('AuthGuard', () => {
    it('rejects requests without a session', async () => {
        getSession.mockResolvedValue(null)
        await expect(new AuthGuard().canActivate(contextFor({ headers: {} }))).rejects.toBeInstanceOf(UnauthorizedException)
    })

    it('stamps user and session on the request when authenticated', async () => {
        getSession.mockResolvedValue(session)
        const request: Record<string, unknown> = { headers: { cookie: 'x' } }
        await expect(new AuthGuard().canActivate(contextFor(request))).resolves.toBe(true)
        expect(request.user).toBe(session.user)
        expect(request.session).toBe(session.session)
    })
})

describe('BetaApprovalGuard', () => {
    function guardFor(awaitingApproval: boolean) {
        const betaService = { isAwaitingApproval: vi.fn(() => Promise.resolve(awaitingApproval)) }
        return { guard: new BetaApprovalGuard(betaService as unknown as BetaService), betaService }
    }

    it('denies requests that AuthGuard has not stamped with a user', async () => {
        const { guard, betaService } = guardFor(false)
        await expect(guard.canActivate(contextFor({}))).resolves.toBe(false)
        expect(betaService.isAwaitingApproval).not.toHaveBeenCalled()
    })

    it("answers 403 'beta-pending' while the user's signup awaits approval", async () => {
        const { guard, betaService } = guardFor(true)
        const error = await guard.canActivate(contextFor({ user: { id: 'u1' } })).catch((e: unknown) => e)
        expect(error).toBeInstanceOf(ForbiddenException)
        expect((error as ForbiddenException).getResponse()).toMatchObject({ code: 'beta-pending' })
        expect(betaService.isAwaitingApproval).toHaveBeenCalledWith('u1')
    })

    it('lets approved and pre-beta users through', async () => {
        const { guard } = guardFor(false)
        await expect(guard.canActivate(contextFor({ user: { id: 'u1' } }))).resolves.toBe(true)
    })
})
