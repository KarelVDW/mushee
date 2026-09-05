import Link from 'next/link'

import { Wordmark } from '@/components/ui'

// Shared capsule styles mirror PrimaryButton / SecondaryButton — those render a
// <button>, and a navigation belongs in a real <Link>.
const capsule = [
    'inline-flex items-center justify-center whitespace-nowrap rounded-full',
    'font-label font-semibold text-[13px] leading-none px-4.5 py-2.25 pointer-coarse:py-3',
    'transition-colors duration-150 ease-solkey',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
].join(' ')

// Signed-out visitors rarely land here (the auth proxy bounces unknown private
// paths to /login first), so the primary way out is the library; the home link
// covers the public marketing paths.
export default function NotFound() {
    return (
        <div className="min-h-dvh bg-surface text-on-surface flex items-center justify-center px-6">
            <div className="text-center flex flex-col items-center gap-4 max-w-md">
                <Wordmark size={28} />
                <h1 className="font-headline font-bold text-[1.75rem] leading-tight m-0">This page doesn&apos;t exist</h1>
                <p className="font-body font-normal text-[14px] leading-normal text-on-surface-variant m-0">
                    The link may be old, or the address was mistyped. Your scores are safe.
                </p>
                <div className="flex items-center gap-3 mt-2">
                    <Link
                        href="/scores"
                        className={`${capsule} bg-primary-container text-on-primary-container hover:bg-primary hover:text-on-primary`}>
                        Back to your library
                    </Link>
                    <Link href="/" className={`${capsule} bg-surface-container-low text-on-surface hover:bg-surface-container`}>
                        Go home
                    </Link>
                </div>
            </div>
        </div>
    )
}
