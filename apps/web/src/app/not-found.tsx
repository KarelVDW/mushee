import type { Metadata } from 'next'
import Link from 'next/link'

import { Wordmark } from '@/components/ui'

import { NotFoundActions } from './NotFoundActions'

export const metadata: Metadata = { title: 'Page not found' }

// Signed-out visitors land here only under public paths (the auth proxy bounces unknown
// private paths to /login first); the actions island picks the way out for each visitor.
export default function NotFound() {
    return (
        <main className="min-h-dvh bg-surface text-on-surface flex items-center justify-center px-6">
            <div className="text-center flex flex-col items-center gap-4 max-w-md">
                <Link href="/" className="no-underline inline-flex items-center pointer-coarse:min-h-10" aria-label="Solkey home">
                    <Wordmark size={28} />
                </Link>
                <h1 className="font-headline font-bold text-[1.75rem] leading-tight m-0">This page doesn&apos;t exist</h1>
                <NotFoundActions />
            </div>
        </main>
    )
}
