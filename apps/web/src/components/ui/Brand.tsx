import type { CSSProperties, ReactNode } from 'react'
import { useLayoutEffect, useRef, useState } from 'react'

interface WordmarkProps {
    size?: number
    className?: string
}

export function Wordmark({ size = 28, className }: WordmarkProps) {
    return (
        <span
            className={`font-display italic font-bold tracking-[-0.04em] leading-none text-on-surface ${className ?? ''}`}
            style={{ fontSize: size }}>
            Sheemu
        </span>
    )
}

interface AppIconProps {
    size?: number
    rounded?: boolean
    background?: string
    className?: string
}

// The Sheemu "S" with a single offset secondary-container drop-shadow behind the letter.
// We measure the letter's ink bbox in a layout effect so the combined letter+shadow is
// optically centred — em-box centring drifts because display-italic glyphs have
// asymmetric sidebearings.
export function AppIcon({ size = 96, rounded = true, background, className }: AppIconProps) {
    const vb = 100
    const unit = vb * 0.045
    const italicNudge = vb * 0.04
    const letterRef = useRef<SVGTextElement | null>(null)
    const [transform, setTransform] = useState('')

    useLayoutEffect(() => {
        const el = letterRef.current
        if (!el) return
        const apply = () => {
            try {
                const b = el.getBBox()
                const cx = b.x + b.width / 2
                const cy = b.y + b.height / 2
                setTransform(`translate(${vb / 2 - cx - italicNudge} ${vb / 2 - cy})`)
            } catch {
                /* font not ready */
            }
        }
        apply()
        if (typeof document !== 'undefined' && document.fonts) {
            void document.fonts.ready.then(apply)
        }
    }, [size, italicNudge])

    return (
        <span
            aria-label="Sheemu app icon"
            role="img"
            className={`inline-flex shrink-0 overflow-hidden ${className ?? ''}`}
            style={{
                width: size,
                height: size,
                background: background ?? 'var(--color-surface-container-lowest)',
                borderRadius: rounded ? Math.round(size * 0.22) : 0,
            }}>
            <svg viewBox={`0 0 ${vb} ${vb}`} width={size} height={size} className="block" aria-hidden>
                <g transform={transform}>
                    <text
                        x={unit / 2}
                        y={unit / 2}
                        fontFamily="var(--font-display)"
                        fontStyle="italic"
                        fontWeight={700}
                        fontSize={vb * 0.86}
                        letterSpacing="-0.04em"
                        fill="var(--color-secondary-container)">
                        S
                    </text>
                    <text
                        ref={letterRef}
                        x={-unit / 2}
                        y={-unit / 2}
                        fontFamily="var(--font-display)"
                        fontStyle="italic"
                        fontWeight={700}
                        fontSize={vb * 0.86}
                        letterSpacing="-0.04em"
                        fill="var(--color-primary-container)">
                        S
                    </text>
                </g>
            </svg>
        </span>
    )
}

export function Eyebrow({ children, className, style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
    return (
        <span
            className={`font-label font-semibold text-[11px] leading-none tracking-[0.12em] uppercase text-on-surface-variant ${className ?? ''}`}
            style={style}>
            {children}
        </span>
    )
}

// Space Grotesk by default; `italic` keeps Space Grotesk italic for in-app titles.
// Newsreader italic is reserved for marketing + auth surfaces — see DESIGN.md §Voice.
export function PageTitle({ children, italic = false }: { children: ReactNode; italic?: boolean }) {
    return (
        <h1 className={`font-display font-bold text-[48px] leading-none tracking-[-0.03em] text-on-surface m-0 ${italic ? 'italic' : ''}`}>
            {children}
        </h1>
    )
}

export function ModalTitle({ children }: { children: ReactNode }) {
    return <h2 className="font-display font-bold text-[32px] leading-[1.05] tracking-[-0.03em] text-on-surface m-0">{children}</h2>
}

export function SubHeadline({ children }: { children: ReactNode }) {
    return <p className="font-body font-normal text-[15px] leading-normal text-on-surface-variant m-0">{children}</p>
}

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
