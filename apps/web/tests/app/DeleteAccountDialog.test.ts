import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/queries', () => ({
    useRequestAccountDeletion: () => ({ mutate: vi.fn(), isPending: false, isSuccess: false, error: null, data: undefined }),
}))

import { DeleteAccountDialog } from '@/app/settings/DeleteAccountDialog'

// React's act() refuses to run outside a test-aware environment.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let unmount: (() => void) | undefined

afterEach(() => {
    unmount?.()
    unmount = undefined
})

function render(props: { onExport?: () => void; exporting?: boolean } = {}): HTMLElement {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    act(() =>
        root.render(
            createElement(DeleteAccountDialog, {
                email: 'e2e@example.com',
                onCancel: () => {},
                onConfirm: () => {},
                onExport: props.onExport ?? (() => {}),
                exporting: props.exporting ?? false,
            }),
        ),
    )
    unmount = () => {
        act(() => root.unmount())
        host.remove()
    }
    return host
}

const button = (host: HTMLElement, text: string) => [...host.querySelectorAll('button')].find((b) => b.textContent === text)

describe('DeleteAccountDialog', () => {
    it('quotes the confirmation phrase in its own case inside the label', () => {
        const host = render()
        const label = [...host.querySelectorAll('label')].find((l) => l.textContent?.includes('to confirm'))
        expect(label?.textContent).toBe('Type “delete my account” to confirm')
        expect(label?.querySelector('span')?.className).toContain('normal-case')
    })

    it('leaves the password field empty rather than masked', () => {
        const host = render()
        const password = host.querySelector<HTMLInputElement>('input[type="password"]')
        expect(password?.placeholder ?? '').toBe('')
        expect(password?.autocomplete).toBe('current-password')
    })

    it('offers the data download right in the dialog, without closing it', () => {
        const onExport = vi.fn()
        const host = render({ onExport })
        act(() => button(host, 'Download my data first')?.click())
        expect(onExport).toHaveBeenCalledOnce()
        expect(host.querySelector('[role="dialog"]')).not.toBeNull()
        unmount?.()
        expect(button(render({ exporting: true }), 'Preparing your download…')).toBeDefined()
    })

    it('keeps the plain acknowledgement', () => {
        const host = render()
        expect(host.textContent).toContain("I understand that after 7 days this can't be undone.")
    })
})
