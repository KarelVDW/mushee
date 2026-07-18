import Link from 'next/link'

import { Wordmark } from '@/components/ui'

// Signed-out visitors never reach this (the auth middleware bounces unknown
// paths to /login first), so the way home is the library.
export default function NotFound() {
    return (
        <div className="min-h-dvh bg-surface text-on-surface flex items-center justify-center px-6">
            <div className="text-center flex flex-col items-center gap-3">
                <Wordmark size={28} />
                <h1 className="font-display font-medium text-[22px] leading-tight">This page doesn&apos;t exist</h1>
                <p className="font-body font-normal text-[14px] leading-normal text-on-surface-variant max-w-sm">
                    The link may be old, or the address was mistyped. Your scores are safe.
                </p>
                <Link
                    href="/scores"
                    className={[
                        'mt-2 inline-flex items-center rounded-full bg-primary text-on-primary',
                        'font-label font-semibold text-[13px] leading-none px-5 py-2.5',
                        'transition-opacity duration-150 ease-solkey hover:opacity-90',
                        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
                    ].join(' ')}>
                    Back to your library
                </Link>
            </div>
        </div>
    )
}
