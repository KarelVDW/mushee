/** Where a haze sits in its section (the section is `relative overflow-hidden`). */
const PLACEMENT = {
    /** Centred on the section's top-right corner, at most 760px across (110vw on phones), so it stays a corner glow. */
    'top-right': 'top-0 right-0 translate-x-1/2 -translate-y-1/2 aspect-square w-[min(110vw,760px)]',
    /**
     * Centred on the section's right edge and exactly as tall as the section, so its fade completes
     * at the section's top and bottom edges and no clip line shows against the bands around it.
     */
    'right-edge': 'top-0 right-0 h-full aspect-square translate-x-1/2',
} as const

/**
 * The marketing surfaces' one coloured atmosphere: a quiet cyan radial gradient pinned to one
 * corner or edge of its section — no blur filter (cheap to scroll, and no banded clip edge).
 * Decorative; the section must clip it (`relative overflow-hidden`) and lift its content above
 * it (`relative z-2`).
 */
export function Haze({ placement }: { placement: keyof typeof PLACEMENT }) {
    return (
        <div
            aria-hidden
            className={`pointer-events-none absolute rounded-full bg-[radial-gradient(closest-side,rgb(0_219_233/0.20),rgb(0_219_233/0.08)_50%,transparent)] ${PLACEMENT[placement]}`}
        />
    )
}
