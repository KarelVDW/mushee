import type { ReactNode } from 'react'

/** Each page grid's content width: the app's 1536px, the public pages' 1280px, and a 760px reading measure. */
const MAX_WIDTH = {
    app: 'max-w-384',
    marketing: 'max-w-320',
    reading: 'max-w-190',
} as const

/** The side gutters: 16px in the app (its nav's), 20px on public pages, 32px on both from sm. */
const GUTTER = {
    app: 'px-4 sm:px-8',
    marketing: 'px-5 sm:px-8',
    reading: 'px-5 sm:px-8',
} as const

interface ContainerProps {
    /** `app` for authenticated chrome and pages, `marketing` for public pages, `reading` for long-form text. */
    width?: keyof typeof MAX_WIDTH
    /** Classes for the inner, width-capped box (its layout: flex, padding-block, gaps). */
    className?: string
    children: ReactNode
}

/**
 * The page grid: a full-width band with the side gutters, and inside it the content box capped
 * at the grid's width and centred. The gutters always sit outside the cap, so a page's content
 * is exactly as wide as its grid says at every viewport, and every page on a grid lines up.
 */
export function Container({ width = 'app', className, children }: ContainerProps) {
    return (
        <div className={`w-full ${GUTTER[width]}`}>
            <div className={`mx-auto ${MAX_WIDTH[width]}${className ? ` ${className}` : ''}`}>{children}</div>
        </div>
    )
}
