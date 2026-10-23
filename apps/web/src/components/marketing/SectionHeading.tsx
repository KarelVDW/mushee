import type { ReactNode } from 'react'

import { Eyebrow } from '@/components/ui'

interface SectionHeadingProps {
    /** The small-caps label over the title ('How it works'); a closing statement goes without. */
    eyebrow?: string
    /** The h2. An italic Newsreader clause in it always starts its own line (a `<br />` before the `<em>`). */
    title: ReactNode
    /** One line or two under the title, at the lede size. */
    sub?: ReactNode
    /** `start` for the content sections (How it works, Features, the FAQ), `center` for the conversion ones (pricing, the closing CTA). */
    align?: 'start' | 'center'
    /** The h2's id, for a section's aria-labelledby. */
    id?: string
    /** Replaces the default space under the heading (mb-12 sm:mb-14): a closing CTA sits closer, a heading with nothing under it takes none. */
    className?: string
}

/**
 * How every marketing section introduces itself: an optional primary eyebrow, the h2 at the
 * page-title role (34px on phones, 48px from sm; the base styles balance its lines), and an
 * optional 17px sub. The same on the landing page and /pricing, so the eye always finds where
 * a section starts.
 */
export function SectionHeading({ eyebrow, title, sub, align = 'start', id, className }: SectionHeadingProps) {
    const centred = align === 'center'
    return (
        <div className={[className ?? 'mb-12 sm:mb-14', centred ? 'text-center' : ''].join(' ')}>
            {eyebrow && <Eyebrow className="text-primary">{eyebrow}</Eyebrow>}
            <h2 id={id} className={`${eyebrow ? 'mt-3' : 'mt-0'} mb-0 type-page text-on-surface`}>
                {title}
            </h2>
            {sub && (
                <p className={`mt-4 mb-0 type-lede text-[17px] text-on-surface-variant max-w-140 text-pretty ${centred ? 'mx-auto' : ''}`}>
                    {sub}
                </p>
            )}
        </div>
    )
}
