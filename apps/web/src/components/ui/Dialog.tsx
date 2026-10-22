'use client'

import { type KeyboardEvent, type ReactNode, useEffect, useEffectEvent, useId, useRef } from 'react'

import { ModalTitle } from './Brand'
import { CloseButton } from './Buttons'

/** Everything keyboard focus can land on — the dialog's Tab trap cycles through these. */
export const FOCUSABLE_SELECTOR = 'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'

interface DialogPanelProps {
    title: ReactNode
    subtitle?: ReactNode
    children?: ReactNode
    footer?: ReactNode
    /** Dismisses the dialog: Escape, a backdrop click and the header × all call it. Omit it to make the dialog non-dismissable. */
    onClose?: () => void
    /** Pixel width — kept as inline style because it's a runtime prop value. */
    width: number
}

/**
 * A modal dialog — the scrim and the glass panel on it — carrying the whole modal
 * contract: role/aria-modal/labelling, focus moved in on open and handed back on
 * close, Tab trapped inside, and one `onClose` for every way of dismissing it.
 */
export function DialogPanel({ title, subtitle, children, footer, onClose, width }: DialogPanelProps) {
    const titleId = useId()
    return (
        <Scrim onDismiss={onClose}>
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
                    {onClose && <CloseButton size="md" onClick={onClose} />}
                </header>
                {/* The body scrolls when the content outgrows the panel (tall dialogs on phones) so the
                    header and footer stay put; -my-1/py-1 keeps focus rings at its edges unclipped. */}
                <div className="px-7 -my-1 py-1 flex-1 min-h-0 flex flex-col overflow-y-auto overscroll-contain">{children}</div>
                {footer && <footer className="px-7 py-5 flex justify-end items-center gap-3">{footer}</footer>}
            </div>
        </Scrim>
    )
}

/** The backdrop plus the focus wrapper around the panel: focus in/out, the Tab trap, Escape and backdrop dismissal. */
function Scrim({ children, onDismiss }: { children: ReactNode; onDismiss?: () => void }) {
    const panelRef = useRef<HTMLDivElement>(null)

    // Move focus into the dialog on open and hand it back to the trigger on close, so
    // keyboard users never end up "behind" the scrim.
    useEffect(() => {
        const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
        panelRef.current?.focus()
        return () => previouslyFocused?.focus()
    }, [])

    // Escape is heard on the document, not only inside the panel: a control that removes itself
    // when used (a shortcut row's × in KeyboardShortcutsDialog) drops focus to <body>, and Escape
    // must still close the dialog from there.
    const dismiss = useEffectEvent(() => onDismiss?.())
    useEffect(() => {
        const onKey = (e: globalThis.KeyboardEvent) => {
            if (e.key === 'Escape') dismiss()
        }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
    }, [])

    const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
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
        <div
            onClick={onDismiss}
            className="fixed inset-0 z-(--z-dialog) bg-on-surface/40 backdrop-blur-xs flex items-center justify-center p-6">
            <div ref={panelRef} tabIndex={-1} onKeyDown={handleKeyDown} onClick={(e) => e.stopPropagation()} className="outline-none">
                {children}
            </div>
        </div>
    )
}
