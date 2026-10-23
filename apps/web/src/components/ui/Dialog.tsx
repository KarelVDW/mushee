'use client'

import { CloseButton, ModalTitle } from '@mushee/ui'
import {
    type CSSProperties,
    type KeyboardEvent,
    type ReactNode,
    type RefObject,
    useCallback,
    useEffect,
    useEffectEvent,
    useId,
    useLayoutEffect,
    useRef,
    useState,
} from 'react'

import { focusWithoutTooltip } from './Tooltip'

/** Everything keyboard focus can land on — the dialog's Tab trap cycles through these. */
export const FOCUSABLE_SELECTOR = 'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'

/** Below Tailwind's `sm` (40rem) a dialog is a bottom sheet — the `max-sm:` classes below. */
const PHONE_QUERY = '(max-width: 39.99rem)'

/** How far a toast stays above a phone dialog's footer, so it never covers the commit button. */
const TOAST_GAP_PX = 12

/**
 * The panel: opaque white on the scrim (fields inside keep their page fill, surface_container_low),
 * with the overlay lift. On sm+ it hangs from a fixed top line, so a dialog whose content grows
 * (a filter narrowing a list, a step appearing) extends downward instead of re-centring, and
 * enters with a short rise; tall dialogs keep the room down to 1.5rem above the viewport's
 * bottom. Under sm it is a full-width bottom sheet with an xl top radius that rises in.
 */
const PANEL_CLASS = [
    'flex flex-col w-(--dialog-w) max-w-[90vw] rounded-lg bg-surface-container-lowest shadow-overlay',
    'animate-dialog-in origin-top',
    'sm:max-h-[calc(100dvh-min(14dvh,8rem)-1.5rem)]',
    'max-sm:w-full max-sm:max-w-none max-sm:max-h-[calc(100dvh-1.5rem)] max-sm:rounded-t-xl max-sm:rounded-b-none',
    'max-sm:animate-[popover-sheet-in_200ms_var(--ease-solkey)]',
].join(' ')

/**
 * One right-aligned row that wraps rather than spilling past the panel's edge; below `sm` the
 * buttons stack full width — a tooltip-wrapped button too — the primary (the last child) on
 * top, clear of the home indicator.
 */
const FOOTER_CLASS = [
    'px-7 py-5 flex flex-wrap justify-end items-center gap-3',
    'max-sm:flex-col-reverse max-sm:items-stretch max-sm:pb-[max(1.25rem,env(safe-area-inset-bottom))]',
    'max-sm:[&>*]:w-full max-sm:[&>*>button]:w-full',
].join(' ')

interface DialogPanelProps {
    title: ReactNode
    subtitle?: ReactNode
    children?: ReactNode
    footer?: ReactNode
    /** Dismisses the dialog: Escape, a backdrop click and the header × all call it. Omit it to make the dialog non-dismissable. */
    onClose?: () => void
    /** Pixel width on sm+ — a runtime prop value, so it rides in as a CSS variable. */
    width: number
}

/**
 * A modal dialog — the scrim and the opaque panel on it — carrying the whole modal
 * contract: role/aria-modal/labelling (the title names it, the subtitle describes it, so
 * "there's no undo" is read out with the name), focus moved in on open and handed back on
 * close, Tab trapped inside, and one `onClose` for every way of dismissing it.
 */
export function DialogPanel({ title, subtitle, children, footer, onClose, width }: DialogPanelProps) {
    const titleId = useId()
    const subtitleId = useId()
    const footerRef = useRef<HTMLElement>(null)
    useToastClearance(footerRef, !!footer)
    return (
        <Scrim onDismiss={onClose}>
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                aria-describedby={subtitle ? subtitleId : undefined}
                className={PANEL_CLASS}
                style={{ '--dialog-w': `${width}px` } as CSSProperties}>
                <header className="px-7 pt-6 pb-4 flex items-start justify-between">
                    <div className="flex flex-col gap-1.5">
                        <ModalTitle id={titleId}>{title}</ModalTitle>
                        {subtitle && (
                            <span
                                id={subtitleId}
                                className="font-body font-normal text-[15px] leading-normal text-pretty text-on-surface-variant">
                                {subtitle}
                            </span>
                        )}
                    </div>
                    {onClose && <CloseButton size="md" onClick={onClose} />}
                </header>
                <DialogBody>{children}</DialogBody>
                {footer && (
                    <footer ref={footerRef} className={FOOTER_CLASS}>
                        {footer}
                    </footer>
                )}
            </div>
        </Scrim>
    )
}

/**
 * The body scrolls when the content outgrows the panel (tall dialogs on phones) so the header and
 * footer stay put, and where it is clipped — below, or above once scrolled — a 16px fade in the
 * panel's white says there is more that way. The -my-1/py-1 pair keeps focus rings at its edges
 * unclipped.
 */
function DialogBody({ children }: { children: ReactNode }) {
    const { ref, measure, scrolled, clipped } = useScrollEdges()
    return (
        <div className="relative -my-1 flex-1 min-h-0 flex flex-col">
            <div ref={ref} onScroll={measure} className="px-7 py-1 flex-1 min-h-0 flex flex-col overflow-y-auto overscroll-contain">
                {children}
            </div>
            {scrolled && (
                <div
                    aria-hidden="true"
                    data-dialog-fade="top"
                    className="pointer-events-none absolute inset-x-0 top-0 h-4 bg-linear-to-b from-surface-container-lowest to-transparent"
                />
            )}
            {clipped && (
                <div
                    aria-hidden="true"
                    data-dialog-fade="bottom"
                    className="pointer-events-none absolute inset-x-0 bottom-0 h-4 bg-linear-to-t from-surface-container-lowest to-transparent"
                />
            )}
        </div>
    )
}

/**
 * Whether a scrolling element has more content above (`scrolled`) or below (`clipped`) its
 * visible part — what the dialog body's and a phone sheet's edge fades show. Re-measured on
 * scroll (pass `measure` as onScroll), on window resize, and whenever the element or one of its
 * children changes size, children that come and go included — content growing inside a
 * scroller of fixed height changes no size the scroller itself reports.
 */
export function useScrollEdges() {
    const ref = useRef<HTMLDivElement>(null)
    const [edges, setEdges] = useState({ scrolled: false, clipped: false })
    const measure = useCallback(() => {
        const el = ref.current
        if (!el) return
        const scrolled = el.scrollTop > 1
        const clipped = el.scrollTop + el.clientHeight < el.scrollHeight - 1
        setEdges((prev) => (prev.scrolled === scrolled && prev.clipped === clipped ? prev : { scrolled, clipped }))
    }, [])
    useLayoutEffect(() => {
        const el = ref.current
        measure()
        window.addEventListener('resize', measure)
        const resize = el && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
        const observe = () => {
            if (!el || !resize) return
            resize.disconnect()
            resize.observe(el)
            for (const child of Array.from(el.children)) resize.observe(child)
        }
        observe()
        const children =
            el && typeof MutationObserver !== 'undefined'
                ? new MutationObserver(() => {
                      observe()
                      measure()
                  })
                : null
        if (el) children?.observe(el, { childList: true })
        return () => {
            window.removeEventListener('resize', measure)
            resize?.disconnect()
            children?.disconnect()
        }
    }, [measure])
    return { ref, measure, ...edges }
}

/**
 * While a phone bottom-sheet dialog with a footer is open, toasts rise above that footer
 * (`--toast-bottom`, read by the app-wide Toaster), measured as it resizes; on close — or once
 * the viewport is no longer phone-wide — the page's own value (the editor dock's, or none) comes back.
 */
function useToastClearance(footerRef: RefObject<HTMLElement | null>, hasFooter: boolean) {
    useEffect(() => {
        const footer = footerRef.current
        if (!footer) return
        const root = document.documentElement
        const previous = root.style.getPropertyValue('--toast-bottom')
        const phone = typeof window.matchMedia === 'function' ? window.matchMedia(PHONE_QUERY) : null
        let raised = false
        const restore = () => {
            if (previous) root.style.setProperty('--toast-bottom', previous)
            else root.style.removeProperty('--toast-bottom')
            raised = false
        }
        const update = () => {
            if (phone?.matches) {
                root.style.setProperty('--toast-bottom', `${footer.offsetHeight + TOAST_GAP_PX}px`)
                raised = true
            } else if (raised) restore()
        }
        update()
        const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
        observer?.observe(footer)
        phone?.addEventListener?.('change', update)
        return () => {
            observer?.disconnect()
            phone?.removeEventListener?.('change', update)
            if (raised) restore()
        }
    }, [footerRef, hasFooter])
}

/**
 * The backdrop plus the focus wrapper around the panel: focus in/out, the Tab trap, Escape and
 * backdrop dismissal. The scrim fades in; on sm+ it hangs the panel from a line 14dvh (at most
 * 8rem) down, under sm it seats the panel on the bottom edge.
 */
function Scrim({ children, onDismiss }: { children: ReactNode; onDismiss?: () => void }) {
    const panelRef = useRef<HTMLDivElement>(null)

    // Move focus into the dialog on open and hand it back to the trigger on close, so
    // keyboard users never end up "behind" the scrim. Handed-back focus doesn't pop the
    // trigger's tooltip: the user didn't move it there.
    useEffect(() => {
        const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
        panelRef.current?.focus()
        return () => focusWithoutTooltip(previouslyFocused)
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
            className="fixed inset-0 z-(--z-dialog) bg-on-surface/40 backdrop-blur-xs flex justify-center p-6 animate-scrim-in sm:items-start sm:pt-[min(14dvh,8rem)] max-sm:items-end max-sm:p-0">
            <div
                ref={panelRef}
                tabIndex={-1}
                onKeyDown={handleKeyDown}
                onClick={(e) => e.stopPropagation()}
                className="outline-none max-sm:w-full">
                {children}
            </div>
        </div>
    )
}
