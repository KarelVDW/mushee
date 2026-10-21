import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { ImageResponse } from 'next/og'

import { BRAND } from '@/lib/brandColors'

export const alt = 'Solkey — the fastest way to get a melody on the page'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

/** Brand OG card: wordmark + tagline on the canvas tone with the two neon accents. */
export default async function OpengraphImage() {
    // Satori can't reach webfonts, so the brand fonts are vendored as static TTFs.
    const [spaceGrotesk, newsreaderItalic, manrope] = await Promise.all([
        readFile(join(process.cwd(), 'src/app/og-fonts/SpaceGrotesk-Bold.ttf')),
        readFile(join(process.cwd(), 'src/app/og-fonts/Newsreader-Italic.ttf')),
        readFile(join(process.cwd(), 'src/app/og-fonts/Manrope-Regular.ttf')),
    ])

    return new ImageResponse(
        <div
            style={{
                width: '100%',
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                padding: '80px',
                background: BRAND.surface,
                color: BRAND.onSurface,
                fontFamily: 'Space Grotesk',
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
            {/* Space Grotesk has no italic; skew mimics the browser's faux-italic wordmark. */}
            <div
                style={{
                    fontSize: 64,
                    fontWeight: 700,
                    letterSpacing: -2.5,
                    transform: 'skewX(-10deg)',
                    display: 'flex',
                }}>
                Solkey
            </div>
            <div
                style={{
                    fontSize: 88,
                    fontWeight: 700,
                    letterSpacing: -3.5,
                    lineHeight: 1.05,
                    marginTop: 28,
                    display: 'flex',
                    flexDirection: 'column',
                }}>
                <span>The fastest way to get</span>
                <span style={{ display: 'flex' }}>
                    a melody&nbsp;
                    <span
                        style={{
                            fontFamily: 'Newsreader',
                            fontStyle: 'italic',
                            fontWeight: 400,
                            letterSpacing: 0,
                            color: BRAND.onPrimaryContainer,
                        }}>
                        on the page.
                    </span>
                </span>
            </div>
            <div style={{ fontFamily: 'Manrope', fontSize: 30, marginTop: 32, color: BRAND.onSurfaceVariant, display: 'flex' }}>
                Play or sing — watch the sheet music appear, live.
            </div>
        </div>,
        {
            ...size,
            fonts: [
                { name: 'Space Grotesk', data: spaceGrotesk, weight: 700, style: 'normal' },
                { name: 'Newsreader', data: newsreaderItalic, weight: 400, style: 'italic' },
                { name: 'Manrope', data: manrope, weight: 400, style: 'normal' },
            ],
        },
    )
}
