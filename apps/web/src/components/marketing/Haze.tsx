/** Where a haze sits in its section (the section is `relative overflow-hidden`). */
const PLACEMENT = {
    /**
     * A corner glow at most 760px across (110vw on phones), centred on the section's right edge with
     * its top on the section's top edge, so the fade is complete along the whole top edge and no clip
     * line shows against the band above (the nav band, the auth brand strip). In a section shorter
     * than it is wide (the desktop hero, the auth card) it flattens to the section's height, so the
     * fade completes at the bottom edge as well.
     */
    'top-right': 'top-0 right-0 translate-x-1/2 aspect-square w-[min(110vw,760px)] max-h-full',
    /**
     * Centred on the section's right edge and exactly as tall as the section, so its fade completes
     * at the section's top and bottom edges and no clip line shows against the bands around it.
     */
    'right-edge': 'top-0 right-0 h-full aspect-square translate-x-1/2',
} as const

/**
 * The marketing surfaces' one coloured atmosphere: a quiet radial gradient of the
 * primary-container cyan (20% at the centre, 8% halfway, then clear), read from the token so it
 * follows the theme, pinned to one corner or edge of its section — no blur filter (cheap to
 * scroll, and no banded clip edge). Decorative; the section must clip it (`relative
 * overflow-hidden`) and lift its content above it (`relative z-2`).
 */
export function Haze({ placement }: { placement: keyof typeof PLACEMENT }) {
    return (
        <div
            aria-hidden
            className={`pointer-events-none absolute rounded-full bg-[radial-gradient(closest-side,color-mix(in_srgb,var(--color-primary-container)_20%,transparent),color-mix(in_srgb,var(--color-primary-container)_8%,transparent)_50%,transparent)] ${PLACEMENT[placement]}`}
        />
    )
}
