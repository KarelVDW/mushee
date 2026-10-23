import type { ReactNode, Ref } from 'react'

interface WordmarkProps {
    size?: number
    className?: string
}

export function Wordmark({ size = 28, className }: WordmarkProps) {
    return (
        <span
            className={`font-display italic font-bold tracking-[-0.04em] leading-none text-on-surface ${className ?? ''}`}
            style={{ fontSize: size }}>
            Solkey
        </span>
    )
}

/** The small-caps label voice — shared by Eyebrow and the kit's field labels. */
export const EYEBROW_CLASS = 'font-label font-semibold text-[11px] leading-none tracking-[0.12em] uppercase text-on-surface-variant'

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
    return <span className={`${EYEBROW_CLASS} ${className ?? ''}`}>{children}</span>
}

// In-app page titles are upright Space Grotesk; Newsreader italic is reserved for
// marketing + auth surfaces — see apps/web/DESIGN.md §Voice.
export function PageTitle({ children }: { children: ReactNode }) {
    return <h1 className="type-page text-on-surface m-0">{children}</h1>
}

const MODAL_TITLE_SIZES = {
    // 26px, 32px from sm: a dialog's or a flow step's headline.
    title: 'type-title',
    // 22px: a compact dialog's title, where the full title would outweigh its few lines.
    lead: 'font-display font-semibold text-[22px] leading-tight tracking-[-0.02em]',
} as const

/**
 * A dialog's or a flow step's title (an h2 under the page's h1; `as="h1"` when it is the
 * page's own heading). Pass `tabIndex={-1}` and a `ref` to move focus to it when a multi-step
 * flow changes step, so a screen reader reads the new question first; programmatic focus
 * draws no ring.
 */
export function ModalTitle({
    children,
    id,
    tabIndex,
    ref,
    as: Heading = 'h2',
    size = 'title',
}: {
    children: ReactNode
    id?: string
    tabIndex?: number
    ref?: Ref<HTMLHeadingElement>
    as?: 'h1' | 'h2'
    size?: keyof typeof MODAL_TITLE_SIZES
}) {
    return (
        <Heading id={id} ref={ref} tabIndex={tabIndex} className={`${MODAL_TITLE_SIZES[size]} text-on-surface m-0 outline-none`}>
            {children}
        </Heading>
    )
}

export function SubHeadline({ children }: { children: ReactNode }) {
    return <p className="font-body font-normal text-[15px] leading-normal text-on-surface-variant m-0 text-pretty">{children}</p>
}

const PRICE_SIZES = {
    md: 'text-[28px]',
    lg: 'text-[32px]',
    xl: 'text-[44px]',
} as const

interface PriceTagProps {
    /** The price as shown, e.g. '$9' or 'Free' — every price in the same display face. */
    amount: ReactNode
    /** After the amount, e.g. '/ month'. */
    cadence?: ReactNode
    /**
     * A quiet second line, e.g. 'billed yearly'. `null` keeps the line's height with nothing
     * shown, so a row of prices lines up when only some have a note; omit it for no line.
     */
    note?: ReactNode | null
    size?: keyof typeof PRICE_SIZES
    className?: string
}

/**
 * A price: the amount in bold Space Grotesk with tabular figures (28/32/44px), its cadence in
 * 14px Manrope beside it, and an optional quiet note under it. Never a monospace price.
 */
export function PriceTag({ amount, cadence, note, size = 'md', className }: PriceTagProps) {
    return (
        <span className={`inline-flex flex-col gap-1 ${className ?? ''}`}>
            <span className="inline-flex items-baseline gap-1.5">
                <span className={`font-display font-bold tabular-nums tracking-[-0.03em] leading-none ${PRICE_SIZES[size]}`}>{amount}</span>
                {cadence != null && (
                    <span className="font-body font-normal text-[14px] leading-none text-on-surface-variant">{cadence}</span>
                )}
            </span>
            {note !== undefined && (
                <span
                    aria-hidden={note === null || undefined}
                    className={`font-body font-normal text-[13px] leading-[1.4] text-on-surface-variant ${note === null ? 'invisible' : ''}`}>
                    {note ?? '\u00a0'}
                </span>
            )}
        </span>
    )
}

const AVATAR_SIZES = {
    sm: 'w-9 h-9 text-[13px]',
    lg: 'w-16 h-16 text-[22px]',
} as const

const AVATAR_TONES = {
    soft: 'bg-secondary-soft text-on-secondary-soft',
    neutral: 'bg-surface-container text-on-surface',
} as const

/** A person's initials in a circle: the first letters of up to two words of their name. */
export function Avatar({
    name,
    size = 'lg',
    tone = 'soft',
    className,
}: {
    name: string
    size?: keyof typeof AVATAR_SIZES
    tone?: keyof typeof AVATAR_TONES
    className?: string
}) {
    const initials = name
        .split(' ')
        .map((s) => s[0])
        .join('')
        .slice(0, 2)
        .toUpperCase()
    return (
        <span
            className={`rounded-full inline-flex items-center justify-center font-label font-semibold leading-none ${AVATAR_SIZES[size]} ${AVATAR_TONES[tone]} ${className ?? ''}`}>
            {initials}
        </span>
    )
}

// Not in the web app's barrel (it never renders one); the admin console does.
interface PillProps {
    children: ReactNode
    tone?: 'neutral' | 'cyan' | 'magenta'
    className?: string
}

const PILL_TONES: Record<NonNullable<PillProps['tone']>, string> = {
    neutral: 'bg-surface-container text-on-surface',
    cyan: 'bg-primary-container text-on-primary-container',
    magenta: 'bg-secondary-container text-on-secondary-container',
}

export function Pill({ children, tone = 'neutral', className }: PillProps) {
    return (
        <span
            className={`rounded-full px-2.5 py-1 font-label font-semibold text-[11px] leading-none whitespace-nowrap ${PILL_TONES[tone]} ${className ?? ''}`}>
            {children}
        </span>
    )
}
