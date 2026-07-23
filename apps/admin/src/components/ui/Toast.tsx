'use client'

import { useEffect, useState } from 'react'

import { Icon } from './Icon'

export interface ToastItem {
    id: number
    message: string
    tone: 'error' | 'info'
    /** Overrides the tone's default glyph (e.g. 'mic' for recording hints). */
    icon?: string
}

const AUTO_DISMISS_MS = 6000

// Module-level store so non-React code (e.g. the React Query caches) can raise
// toasts without threading a context through every call site.
let nextId = 1
let items: ToastItem[] = []
const listeners = new Set<(items: ToastItem[]) => void>()
const timers = new Map<number, ReturnType<typeof setTimeout>>()

function emit() {
    for (const listener of listeners) listener(items)
}

export function dismissToast(id: number) {
    const timer = timers.get(id)
    if (timer) clearTimeout(timer)
    timers.delete(id)
    items = items.filter((t) => t.id !== id)
    emit()
}

export function showToast(message: string, tone: ToastItem['tone'] = 'error', icon?: string) {
    // An identical visible toast just gets its timer reset — repeated failures
    // (e.g. a retrying auto-save) shouldn't stack into a wall of red.
    const existing = items.find((t) => t.message === message && t.tone === tone)
    if (existing) {
        clearTimeout(timers.get(existing.id))
        timers.set(
            existing.id,
            setTimeout(() => dismissToast(existing.id), AUTO_DISMISS_MS),
        )
        return
    }
    const item: ToastItem = { id: nextId++, message, tone, icon }
    items = [...items, item]
    timers.set(
        item.id,
        setTimeout(() => dismissToast(item.id), AUTO_DISMISS_MS),
    )
    emit()
}

/** Floating glass dock that surfaces toast messages. Mount once, in the root layout. */
export function Toaster() {
    const [visible, setVisible] = useState<ToastItem[]>(items)

    useEffect(() => {
        listeners.add(setVisible)
        return () => {
            listeners.delete(setVisible)
        }
    }, [])

    if (visible.length === 0) return null

    return (
        <div className="fixed bottom-[max(1.5rem,env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 z-50 w-max max-w-[calc(100vw-2rem)] flex flex-col items-center gap-3 pointer-events-none" role="status">
            {visible.map((toast) => (
                <div
                    key={toast.id}
                    className={[
                        'pointer-events-auto flex items-center gap-3 max-w-full sm:max-w-xl',
                        'bg-surface-container-lowest/85 backdrop-blur-[12px] rounded-lg editorial-shadow',
                        'pl-3 pr-2 py-2.5',
                    ].join(' ')}>
                    <span
                        className={[
                            'w-7 h-7 rounded-full shrink-0 inline-flex items-center justify-center',
                            toast.tone === 'error'
                                ? 'bg-error-container text-on-error-container'
                                : 'bg-primary-container text-on-primary-container',
                        ].join(' ')}>
                        <Icon name={toast.icon ?? (toast.tone === 'error' ? 'error' : 'info')} size={16} />
                    </span>
                    <span className="font-body font-medium text-[13px] leading-[1.4] text-on-surface">{toast.message}</span>
                    <button
                        type="button"
                        aria-label="Dismiss"
                        onClick={() => dismissToast(toast.id)}
                        className="bg-transparent border-0 p-1.5 cursor-pointer text-on-surface-variant hover:text-on-surface inline-flex shrink-0">
                        <Icon name="x" size={14} />
                    </button>
                </div>
            ))}
        </div>
    )
}
