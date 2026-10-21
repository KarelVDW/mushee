import { PrimaryButton, SecondaryButton, Wordmark } from '@/components/ui'

// Signed-out visitors rarely land here (the auth proxy bounces unknown private
// paths to /login first), so the primary way out is the library; the home link
// covers the public marketing paths.
export default function NotFound() {
    return (
        <main className="min-h-dvh bg-surface text-on-surface flex items-center justify-center px-6">
            <div className="text-center flex flex-col items-center gap-4 max-w-md">
                <Wordmark size={28} />
                <h1 className="font-headline font-bold text-[1.75rem] leading-tight m-0">This page doesn&apos;t exist</h1>
                <p className="font-body font-normal text-[14px] leading-normal text-on-surface-variant m-0">
                    The link may be old, or the address was mistyped. Your scores are safe.
                </p>
                <div className="flex items-center gap-3 mt-2">
                    <PrimaryButton href="/scores">Back to your library</PrimaryButton>
                    <SecondaryButton href="/">Go home</SecondaryButton>
                </div>
            </div>
        </main>
    )
}
