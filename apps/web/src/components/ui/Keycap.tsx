import type { ReactNode } from 'react'

interface KeycapProps {
    /** The key as text ("Q", "⇧⌘Z", "Ctrl+Shift+Z", ":"). */
    children: ReactNode
    /** `sm` (default): 20px tall, for tooltips and inline hints. `md`: 24px, for a list of shortcuts. */
    size?: 'sm' | 'md'
    className?: string
}

/** A key that is a lone punctuation mark or symbol (":", ".", "/", "↑"), which the label face draws too small to read. */
const LONE_SYMBOL = /^[\p{P}\p{S}]$/u

/**
 * One key drawn as a keycap — the one keycap style everywhere a shortcut is printed (tooltips,
 * the More popover, the shortcuts list): a small surface_container cap with a faint bottom edge,
 * in the label face, a lone punctuation mark in the mono face a size up so a ":" stays legible.
 * Always a `<kbd>`, which is how assistive tech and the tests find a key.
 */
export function Keycap({ children, size = 'sm', className }: KeycapProps) {
    const symbol = typeof children === 'string' && LONE_SYMBOL.test(children)
    return (
        <kbd
            className={[
                'inline-flex items-center justify-center px-1.5 rounded-sm bg-surface-container leading-none text-on-surface',
                'shadow-[inset_0_-1px_0_rgb(45_47_47/0.12)]',
                size === 'md' ? 'h-6 min-w-6' : 'h-5 min-w-5',
                symbol ? 'font-mono text-[14px]' : 'font-label font-semibold text-[11px]',
                className ?? '',
            ]
                .filter(Boolean)
                .join(' ')}>
            {children}
        </kbd>
    )
}
