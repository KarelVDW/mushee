'use client'

import { useEffect } from 'react'

import { captureException } from '@/lib/analytics'

/**
 * Last-resort boundary: catches errors thrown by the root layout itself.
 * Must render its own <html>/<body> and cannot rely on app CSS being intact
 * (globals.css is imported by the layout that just failed), so styling is
 * intentionally self-contained: the palette hexes below are the design tokens
 * `surface`, `on-surface`, `on-surface-variant`, `primary-container`,
 * `on-primary-container` and `surface-container-low` spelled out by hand.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
    useEffect(() => {
        console.error(error)
        captureException(error, { digest: error.digest, boundary: 'global' })
    }, [error])

    const capsule = {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: 0,
        borderRadius: 9999,
        padding: '0.7rem 1.5rem',
        fontSize: 13,
        fontWeight: 600,
        lineHeight: 1,
        cursor: 'pointer',
        textDecoration: 'none',
        fontFamily: 'inherit',
    } as const

    return (
        <html lang="en">
            <body
                style={{
                    margin: 0,
                    minHeight: '100vh',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: '#f6f6f6',
                    color: '#2d2f2f',
                    fontFamily: 'system-ui, sans-serif',
                    textAlign: 'center',
                }}>
                <div style={{ maxWidth: 420, padding: '0 2rem' }}>
                    <p style={{ fontSize: 28, fontWeight: 700, fontStyle: 'italic', letterSpacing: '-0.04em', margin: '0 0 1rem' }}>
                        Solkey
                    </p>
                    <h1 style={{ fontSize: '1.75rem', lineHeight: 1.2, margin: '0 0 0.75rem' }}>Something went wrong</h1>
                    <p style={{ fontSize: 14, lineHeight: 1.5, color: '#5a5c5c', margin: '0 0 1.5rem' }}>
                        An unexpected error stopped Solkey from loading. Your scores are safe — try again, and if it keeps happening, come
                        back in a few minutes.
                    </p>
                    <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
                        <button type="button" onClick={reset} style={{ ...capsule, background: '#00dbe9', color: '#005359' }}>
                            Try again
                        </button>
                        <a href="/" style={{ ...capsule, background: '#f0f1f1', color: '#2d2f2f' }}>
                            Go home
                        </a>
                    </div>
                </div>
            </body>
        </html>
    )
}
