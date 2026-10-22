import type { ReactNode } from 'react'

/**
 * Card surface every panel in this app sits on. `flush` drops the padding for
 * edge-to-edge content like tables; a `p-0` className can't, because Tailwind
 * emits the padding shorthand before the px/py longhands it would override.
 */
export function Card({ children, className, flush }: { children: ReactNode; className?: string; flush?: boolean }) {
    return (
        <div className={`bg-surface-container-lowest rounded-lg tonal-layer-glow ${flush ? '' : 'px-5 py-4'} ${className ?? ''}`}>
            {children}
        </div>
    )
}
