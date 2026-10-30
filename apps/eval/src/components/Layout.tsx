import { Eyebrow } from '@mushee/ui'
import Link from 'next/link'
import type { ReactNode } from 'react'

import { Card } from './Card'

/** Page heading block: eyebrow section label + title + an optional side slot (the admin console's shape). */
export function PageHeading({
    eyebrow,
    title,
    children,
    back,
}: {
    eyebrow: string
    title: ReactNode
    children?: ReactNode
    back?: { href: string; label: string }
}) {
    return (
        <header className="flex flex-wrap items-end justify-between gap-4 mb-8">
            <div className="flex flex-col gap-2 min-w-0">
                {back ? (
                    <Link href={back.href} className="no-underline hover:underline focus-ring rounded-sm w-fit">
                        <Eyebrow>← {back.label}</Eyebrow>
                    </Link>
                ) : (
                    <Eyebrow>{eyebrow}</Eyebrow>
                )}
                <h1 className="font-display font-bold text-[26px] sm:text-[32px] leading-none tracking-[-0.03em] text-on-surface m-0 text-balance break-words">
                    {title}
                </h1>
            </div>
            {children}
        </header>
    )
}

/** A titled panel: the eyebrow labels the section inside the card, the optional aside carries its key number or link. */
export function Section({
    title,
    aside,
    hint,
    children,
    flush,
    className,
}: {
    title: string
    aside?: ReactNode
    hint?: ReactNode
    children: ReactNode
    flush?: boolean
    className?: string
}) {
    return (
        <Card flush={flush} className={className}>
            <div className={`flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 ${flush ? 'px-5 pt-4 pb-3' : 'mb-3'}`}>
                <Eyebrow>{title}</Eyebrow>
                {aside && <div className="font-body text-[13px] text-on-surface-variant">{aside}</div>}
                {hint && (
                    <p className="basis-full font-body text-[13px] leading-snug text-on-surface-variant m-0 mt-1 text-pretty">{hint}</p>
                )}
            </div>
            {children}
        </Card>
    )
}

/** What a page shows when its data isn't on this machine yet, and how to make it. */
export function EmptyNote({ title, children }: { title: string; children: ReactNode }) {
    return (
        <Card>
            <p className="type-subheading text-on-surface m-0 mb-1">{title}</p>
            <div className="font-body text-[14px] leading-relaxed text-on-surface-variant text-pretty [&_code]:font-mono [&_code]:text-[13px] [&_code]:text-on-surface">
                {children}
            </div>
        </Card>
    )
}
