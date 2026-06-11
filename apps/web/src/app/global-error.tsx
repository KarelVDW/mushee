'use client'

/**
 * Last-resort boundary: catches errors thrown by the root layout itself.
 * Must render its own <html>/<body> and cannot rely on app CSS being intact,
 * so styling is intentionally self-contained.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
    console.error(error)
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
                    <h1 style={{ fontSize: '1.75rem', margin: '0 0 0.75rem' }}>Something went wrong</h1>
                    <p style={{ fontSize: 14, lineHeight: 1.5, color: '#5a5c5c', margin: '0 0 1.5rem' }}>
                        An unexpected error stopped Sheemu from loading. Try again, and if it keeps happening, come back in a few minutes.
                    </p>
                    <button
                        type="button"
                        onClick={reset}
                        style={{
                            border: 0,
                            borderRadius: 9999,
                            padding: '0.7rem 1.5rem',
                            fontSize: 13,
                            fontWeight: 600,
                            cursor: 'pointer',
                            background: '#00dbe9',
                            color: '#005359',
                        }}>
                        Try again
                    </button>
                </div>
            </body>
        </html>
    )
}
