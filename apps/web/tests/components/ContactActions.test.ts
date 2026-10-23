import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const visitor = vi.hoisted(() => ({ authed: false }))
const { showToast } = vi.hoisted(() => ({ showToast: vi.fn() }))

vi.mock('@/lib/auth-client', () => ({
    useSession: () => ({ data: visitor.authed ? { user: { id: 'u1' } } : null }),
    useHydratedSession: () => ({ data: visitor.authed ? { user: { id: 'u1' } } : null }),
}))
vi.mock('@/components/ui', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/components/ui')>()),
    showToast,
}))

import { CopyAddressButton, SettingsSupportLink } from '@/app/contact/ContactActions'

// React's act() refuses to run outside a test-aware environment.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('CopyAddressButton', () => {
    let host: HTMLElement
    let root: Root
    const writeText = vi.fn()

    beforeEach(() => {
        showToast.mockClear()
        writeText.mockReset()
        vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
        host = document.createElement('div')
        document.body.appendChild(host)
        root = createRoot(host)
        act(() => root.render(createElement(CopyAddressButton, { address: 'support@solkey.io' })))
    })

    afterEach(() => {
        act(() => root.unmount())
        host.remove()
        vi.unstubAllGlobals()
    })

    /** Click, then let the copy's promise settle. */
    const click = (): Promise<void> => {
        host.querySelector('button')?.click()
        return Promise.resolve()
    }

    it('copies the address and confirms', async () => {
        writeText.mockResolvedValue(undefined)
        await act(() => click())
        expect(writeText).toHaveBeenCalledWith('support@solkey.io')
        expect(showToast).toHaveBeenCalledWith('Address copied.', 'info', { icon: 'check' })
    })

    it('says the address where the clipboard refuses', async () => {
        writeText.mockRejectedValue(new Error('denied'))
        await act(() => click())
        expect(showToast).toHaveBeenCalledWith("Couldn't copy it — the address is support@solkey.io.")
    })
})

describe('SettingsSupportLink', () => {
    it('points a signed-in visitor at the account tab, and stays out of a stranger’s way', () => {
        expect(renderToStaticMarkup(createElement(SettingsSupportLink))).toBe('')
        visitor.authed = true
        expect(renderToStaticMarkup(createElement(SettingsSupportLink))).toContain('href="/settings?tab=account"')
    })
})
