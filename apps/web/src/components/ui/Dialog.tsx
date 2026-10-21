'use client'

import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef } from 'react'

import { ModalTitle } from './Brand'
import { Icon } from './Icon'

/** Everything keyboard focus can land on — the dialog's Tab trap cycles through these. */
export const FOCUSABLE_SELECTOR =
    'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'

interface DialogScrimProps {
    children: ReactNode
    onDismiss?: () => void
}

export function DialogScrim({ children, onDismiss }: DialogScrimProps) {
    const panelRef = useRef<HTMLDivElement>(null)

    // Move focus into the dialog on open and hand it back to the trigger on close, so
    // keyboard users never end up "behind" the scrim.
    useEffect(() => {
        const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
        panelRef.current?.focus()
        return () => previouslyFocused?.focus()
    }, [])

    const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
        if (e.key === 'Escape') {
            onDismiss?.()
            return
        }
        if (e.key !== 'Tab') return
        // Cycle Tab within the dialog instead of letting it escape into the page behind.
        const focusables = panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
        if (!focusables?.length) return
        const first = focusables[0]
        const last = focusables[focusables.length - 1]
        if (e.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) {
            e.preventDefault()
            last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault()
            first.focus()
        }
    }

    return (
        <div onClick={onDismiss} className="fixed inset-0 z-100 bg-on-surface/40 backdrop-blur-xs flex items-center justify-center p-6">
            <div ref={panelRef} tabIndex={-1} onKeyDown={handleKeyDown} onClick={(e) => e.stopPropagation()} className="outline-none">
                {children}
            </div>
        </div>
    )
}

interface DialogPanelProps {
    title: ReactNode
    subtitle?: ReactNode
    children?: ReactNode
    footer?: ReactNode
    onClose?: () => void
    /** Pixel width — kept as inline style because it's a runtime prop value. */
    width?: number
}

export function DialogPanel({ title, subtitle, children, footer, onClose, width = 560 }: DialogPanelProps) {
    const titleId = useId()
    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="glass-panel rounded-lg editorial-shadow max-w-[90vw] max-h-[90dvh] flex flex-col"
            style={{ width }}>
            <header className="px-7 pt-6 pb-4 flex items-start justify-between">
                <div className="flex flex-col gap-1.5">
                    <ModalTitle id={titleId}>{title}</ModalTitle>
                    {subtitle && (
                        <span className="font-body font-normal text-[13px] leading-[1.4] text-on-surface-variant">{subtitle}</span>
                    )}
                </div>
                {onClose && (
                    <button
                        onClick={onClose}
                        aria-label="Close"
                        className={[
                            'bg-transparent border-0 text-on-surface-variant cursor-pointer p-1 rounded-full',
                            'hover:text-on-surface transition-colors duration-150 ease-solkey',
                            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
                        ].join(' ')}>
                        <Icon name="x" size={20} />
                    </button>
                )}
            </header>
            {/* The body scrolls when the content outgrows the panel (tall dialogs on phones) so the
                header and footer stay put; -my-1/py-1 keeps focus rings at its edges unclipped. */}
            <div className="px-7 -my-1 py-1 flex-1 min-h-0 flex flex-col overflow-y-auto overscroll-contain">{children}</div>
            {footer && <footer className="px-7 py-5 flex justify-end items-center gap-3">{footer}</footer>}
        </div>
    )
}
