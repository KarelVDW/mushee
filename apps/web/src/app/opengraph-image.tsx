import { ImageResponse } from 'next/og'

export const alt = 'Sheemu — the fastest way to get a melody on the page'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

/** Brand OG card: wordmark + tagline on the canvas tone with the two neon accents. */
export default function OpengraphImage() {
    return new ImageResponse(
        (
            <div
                style={{
                    width: '100%',
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'center',
                    padding: '80px',
                    background: '#f6f6f6',
                    color: '#2d2f2f',
                    fontFamily: 'Georgia, serif',
                    position: 'relative',
                }}>
                <div
                    style={{
                        position: 'absolute',
                        top: -160,
                        right: -80,
                        width: 480,
                        height: 480,
                        borderRadius: 9999,
                        background: 'rgba(0,219,233,0.35)',
                        filter: 'blur(80px)',
                    }}
                />
                <div
                    style={{
                        position: 'absolute',
                        bottom: -200,
                        left: -60,
                        width: 420,
                        height: 420,
                        borderRadius: 9999,
                        background: 'rgba(255,32,121,0.18)',
                        filter: 'blur(80px)',
                    }}
                />
                <div style={{ fontSize: 64, fontStyle: 'italic', fontWeight: 700, display: 'flex' }}>Sheemu</div>
                <div
                    style={{
                        fontSize: 88,
                        fontWeight: 700,
                        letterSpacing: '-0.03em',
                        lineHeight: 1.05,
                        marginTop: 28,
                        display: 'flex',
                        flexDirection: 'column',
                    }}>
                    <span>The fastest way to get</span>
                    <span style={{ display: 'flex' }}>
                        a melody&nbsp;<span style={{ fontStyle: 'italic', color: '#005359' }}>on the page.</span>
                    </span>
                </div>
                <div style={{ fontSize: 30, marginTop: 32, color: '#5a5c5c', display: 'flex' }}>
                    Play or sing — watch clean sheet music appear, live.
                </div>
            </div>
        ),
        size,
    )
}
