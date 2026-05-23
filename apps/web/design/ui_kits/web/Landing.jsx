// Landing page — marketing surface for new visitors.
// Fuller layout: nav → hero → trust strip → how-it-works → features → testimonials → pricing teaser → final CTA → footer.

function Landing({ onSignIn, onGetStarted }) {
    return (
        <div
            data-screen-label="Landing"
            style={{ background: 'var(--color-surface)', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
            <LandingNav onSignIn={onSignIn} onGetStarted={onGetStarted} />
            <LandingHero onSignIn={onSignIn} onGetStarted={onGetStarted} />
            <TrustStrip />
            <HowItWorks />
            <FeatureGrid />
            <Testimonials />
            <PricingTeaser onGetStarted={onGetStarted} />
            <FinalCTA onGetStarted={onGetStarted} />
            <Footer />
            <CookieBanner />
        </div>
    )
}

/* ─────────── Cookie consent ─────────── */
function CookieBanner() {
    const [dismissed, setDismissed] = useState(false)
    if (dismissed) return null
    return (
        <div
            role="dialog"
            aria-label="Cookie preferences"
            style={{
                position: 'fixed',
                bottom: 20,
                left: 20,
                right: 20,
                zIndex: 60,
                maxWidth: 720,
                margin: '0 auto',
                background: 'rgba(255,255,255,0.96)',
                backdropFilter: 'blur(12px)',
                WebkitBackdropFilter: 'blur(12px)',
                borderRadius: 12,
                padding: '18px 22px',
                boxShadow: 'var(--shadow-tonal)',
                display: 'flex',
                alignItems: 'center',
                gap: 20,
                flexWrap: 'wrap',
            }}>
            <div style={{ flex: 1, minWidth: 220, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span
                    style={{
                        font: '600 11px/1 var(--font-label)',
                        letterSpacing: '0.14em',
                        textTransform: 'uppercase',
                        color: 'var(--color-on-surface-variant)',
                    }}>
                    Cookies
                </span>
                <p style={{ font: '400 14px/1.5 var(--font-body)', color: 'var(--color-on-surface)', margin: 0 }}>
                    We use a few cookies to remember your scores and improve the editor.{' '}
                    <a href="#" style={{ color: 'var(--color-primary)', textDecoration: 'underline' }}>
                        Read more
                    </a>
                    .
                </p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                <TertiaryButton onClick={() => setDismissed(true)}>Decline</TertiaryButton>
                <PrimaryButton onClick={() => setDismissed(true)}>Accept</PrimaryButton>
            </div>
        </div>
    )
}

/* ─────────── Nav ─────────── */
function LandingNav({ onSignIn, onGetStarted }) {
    return (
        <nav
            style={{
                position: 'sticky',
                top: 0,
                zIndex: 50,
                background: 'rgba(246,246,246,0.85)',
                backdropFilter: 'blur(16px)',
                WebkitBackdropFilter: 'blur(16px)',
            }}>
            <div
                style={{
                    maxWidth: 1280,
                    margin: '0 auto',
                    padding: '20px 32px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                }}>
                <Wordmark size={28} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
                    <a href="#features" style={navLinkStyle}>
                        Features
                    </a>
                    <a href="#how" style={navLinkStyle}>
                        How it works
                    </a>
                    <a href="#pricing" style={navLinkStyle}>
                        Pricing
                    </a>
                    <TertiaryButton onClick={onSignIn}>Sign in</TertiaryButton>
                    <PrimaryButton emphasis="pop" icon="arrow-right" onClick={onGetStarted}>
                        Start composing
                    </PrimaryButton>
                </div>
            </div>
        </nav>
    )
}
const navLinkStyle = {
    font: '500 14px/1 var(--font-body)',
    color: 'var(--color-on-surface-variant)',
    textDecoration: 'none',
    whiteSpace: 'nowrap',
}

/* ─────────── Hero ─────────── */
function LandingHero({ onSignIn, onGetStarted }) {
    return (
        <section style={{ position: 'relative', overflow: 'hidden', paddingTop: 64, paddingBottom: 80 }}>
            <div
                style={{
                    position: 'absolute',
                    top: '-10%',
                    right: '-5%',
                    width: 480,
                    height: 480,
                    background: 'rgba(0,219,233,0.18)',
                    borderRadius: '50%',
                    filter: 'blur(120px)',
                    pointerEvents: 'none',
                }}
            />
            <div
                style={{
                    position: 'absolute',
                    bottom: '-15%',
                    left: '-5%',
                    width: 360,
                    height: 360,
                    background: 'rgba(255,32,121,0.10)',
                    borderRadius: '50%',
                    filter: 'blur(120px)',
                    pointerEvents: 'none',
                }}
            />
            <div
                style={{
                    maxWidth: 1280,
                    margin: '0 auto',
                    padding: '0 32px',
                    position: 'relative',
                    zIndex: 2,
                    display: 'grid',
                    gridTemplateColumns: '1.1fr 1fr',
                    gap: 48,
                    alignItems: 'center',
                }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                    <Eyebrow color="var(--color-primary)">A score editor for the rest of us</Eyebrow>
                    <h1
                        style={{
                            fontFamily: 'var(--font-display)',
                            fontWeight: 700,
                            fontSize: 76,
                            lineHeight: 0.95,
                            letterSpacing: '-0.04em',
                            color: 'var(--color-on-surface)',
                            margin: 0,
                        }}>
                        Write the music
                        <br />
                        <em style={{ fontFamily: 'var(--font-serif)', fontWeight: 400 }}>in your head.</em>
                    </h1>
                    <p
                        style={{
                            font: '400 18px/1.5 var(--font-body)',
                            color: 'var(--color-on-surface-variant)',
                            margin: 0,
                            maxWidth: 480,
                        }}>
                        Sheemu is a fast, quiet space for sketching scores — no fiddly menus, no twelve dialogs to find a sharp. Just you
                        and the notes.
                    </p>
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
                        <PrimaryButton size="lg" emphasis="pop" icon="arrow-right" onClick={onGetStarted}>
                            Start composing — it's free
                        </PrimaryButton>
                        <TertiaryButton onClick={onSignIn}>Already have an account?</TertiaryButton>
                    </div>
                </div>

                {/* Hero "screenshot" */}
                <div
                    style={{
                        background: 'var(--color-surface-container-lowest)',
                        borderRadius: 12,
                        boxShadow: '0 0 24px 0 rgba(45,47,47,0.06)',
                        padding: 24,
                        transform: 'rotate(-1.5deg)',
                    }}>
                    <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
                        <span style={{ width: 10, height: 10, borderRadius: 9999, background: 'var(--color-surface-container-high)' }} />
                        <span style={{ width: 10, height: 10, borderRadius: 9999, background: 'var(--color-surface-container-high)' }} />
                        <span style={{ width: 10, height: 10, borderRadius: 9999, background: 'var(--color-surface-container-high)' }} />
                    </div>
                    <div
                        style={{
                            background: 'var(--color-surface-container-low)',
                            borderRadius: 4,
                            padding: 12,
                            marginBottom: 12,
                            display: 'flex',
                            gap: 6,
                        }}>
                        {['𝅝', '𝅗𝅥', '𝅘𝅥', '𝅘𝅥𝅮', '𝅘𝅥𝅯'].map((g, i) => (
                            <span
                                key={i}
                                style={{
                                    background: i === 2 ? 'var(--color-primary-container)' : 'var(--color-surface-container-lowest)',
                                    color: i === 2 ? 'var(--color-on-primary-container)' : 'var(--color-on-surface)',
                                    padding: '4px 10px',
                                    borderRadius: 4,
                                    fontSize: 16,
                                }}>
                                {g}
                            </span>
                        ))}
                    </div>
                    <svg viewBox="0 0 600 160" width="100%" height="160">
                        {[0, 1, 2, 3, 4].map((i) => (
                            <line key={i} x1={20} x2={580} y1={40 + i * 10} y2={40 + i * 10} stroke="#2d2f2f" strokeWidth={1} />
                        ))}
                        <text x={26} y={88} fontFamily="serif" fontSize={56} fill="#2d2f2f">
                            𝄞
                        </text>
                        {[120, 180, 240, 300, 360, 420, 480, 540].map((x, i) => {
                            const cy = 40 + [2, 1, 0, 1, 2, 3, 2, 1][i] * 10
                            return (
                                <g key={x}>
                                    <ellipse cx={x} cy={cy} rx={5} ry={4} fill="#2d2f2f" transform={`rotate(-15 ${x} ${cy})`} />
                                    <line x1={x + 5} y1={cy} x2={x + 5} y2={cy - 28} stroke="#2d2f2f" strokeWidth={1.4} />
                                </g>
                            )
                        })}
                    </svg>
                </div>
            </div>
        </section>
    )
}

/* ─────────── Trust strip ─────────── */
function TrustStrip() {
    return (
        <section style={{ padding: '32px 32px', background: 'var(--color-surface-container-low)' }}>
            <div
                style={{
                    maxWidth: 1280,
                    margin: '0 auto',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 32,
                    flexWrap: 'wrap',
                }}>
                <span
                    style={{
                        font: '600 11px/1 var(--font-label)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.12em',
                        color: 'var(--color-on-surface-variant)',
                        whiteSpace: 'nowrap',
                    }}>
                    Trusted by composers at
                </span>
                <div style={{ display: 'flex', gap: 40, flexWrap: 'wrap', alignItems: 'center', opacity: 0.55 }}>
                    {['Royal Conservatory', 'Berklee', 'Juilliard', 'RNCM', 'CalArts', 'Trinity Laban'].map((name) => (
                        <span
                            key={name}
                            style={{ font: '600 16px/1 var(--font-display)', letterSpacing: '-0.02em', color: 'var(--color-on-surface)' }}>
                            {name}
                        </span>
                    ))}
                </div>
            </div>
        </section>
    )
}

/* ─────────── How it works ─────────── */
function HowItWorks() {
    const steps = [
        ['01', 'Pick your instruments', 'Start from a template or build your own ensemble. Add, remove, or transpose at any time.'],
        ['02', 'Write the notes', 'Type, click, or play your MIDI keyboard. Sheemu handles the engraving as you go.'],
        ['03', 'Hear it back', "Real instrument sounds. Loop a bar, slow it down, or export to MIDI when you're ready."],
    ]
    return (
        <section id="how" style={{ padding: '88px 32px' }}>
            <div style={{ maxWidth: 1280, margin: '0 auto' }}>
                <div style={{ marginBottom: 48 }}>
                    <Eyebrow color="var(--color-primary)">How it works</Eyebrow>
                    <h2
                        style={{
                            fontFamily: 'var(--font-display)',
                            fontWeight: 700,
                            fontSize: 48,
                            lineHeight: 1,
                            letterSpacing: '-0.03em',
                            color: 'var(--color-on-surface)',
                            margin: '12px 0 0',
                            maxWidth: 640,
                        }}>
                        From idea to score in three steps.
                    </h2>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 32 }}>
                    {steps.map(([num, title, body]) => (
                        <div key={num} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                            <span style={{ font: '500 14px/1 var(--font-mono)', color: 'var(--color-primary)' }}>{num}</span>
                            <h3
                                style={{
                                    font: '600 22px/1.25 var(--font-headline)',
                                    letterSpacing: '-0.01em',
                                    color: 'var(--color-on-surface)',
                                    margin: 0,
                                }}>
                                {title}
                            </h3>
                            <p style={{ font: '400 15px/1.55 var(--font-body)', color: 'var(--color-on-surface-variant)', margin: 0 }}>
                                {body}
                            </p>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    )
}

/* ─────────── Feature grid ─────────── */
function FeatureGrid() {
    return (
        <section id="features" style={{ padding: '88px 32px', background: 'var(--color-surface-container-lowest)' }}>
            <div style={{ maxWidth: 1280, margin: '0 auto' }}>
                <h2
                    style={{
                        fontFamily: 'var(--font-display)',
                        fontWeight: 700,
                        fontSize: 48,
                        lineHeight: 1,
                        letterSpacing: '-0.03em',
                        margin: 0,
                        marginBottom: 12,
                        color: 'var(--color-on-surface)',
                    }}>
                    Quiet tools, real notation.
                </h2>
                <p
                    style={{
                        font: '400 16px/1.5 var(--font-body)',
                        color: 'var(--color-on-surface-variant)',
                        maxWidth: 560,
                        margin: 0,
                        marginBottom: 48,
                    }}>
                    Everything you need to sketch a piece, nothing you don't. Built on real SMuFL notation under the hood.
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 24 }}>
                    {[
                        ['feather', 'Fast input', 'MIDI, keyboard, or click. Switch durations and accidentals without losing your place.'],
                        [
                            'users',
                            'Real instruments',
                            'Pick from piano, strings, winds, brass, and traditional instruments — the staff adapts.',
                        ],
                        [
                            'cloud',
                            'Saved as you go',
                            'Every change is kept. Open the same piece on any device and pick up where you left off.',
                        ],
                        ['audio-lines', 'Hear it back', 'Lifelike instrument samples. Loop, slow down, and proof your work by ear.'],
                        [
                            'sliders-horizontal',
                            'Engraver-grade output',
                            'Spacing, beaming, and ties laid out with the same rules a pro engraver follows.',
                        ],
                        ['shield', 'Yours forever', 'Export to MusicXML or PDF any time. Your music belongs to you, not us.'],
                    ].map(([icon, title, body]) => (
                        <div
                            key={title}
                            style={{
                                background: 'var(--color-surface)',
                                borderRadius: 12,
                                padding: 24,
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 12,
                            }}>
                            <div
                                style={{
                                    width: 44,
                                    height: 44,
                                    borderRadius: 9999,
                                    background: 'var(--color-primary-soft)',
                                    color: 'var(--color-on-primary-soft)',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                }}>
                                <Icon name={icon} size={22} />
                            </div>
                            <h3
                                style={{
                                    font: '600 18px/1.3 var(--font-headline)',
                                    letterSpacing: '-0.005em',
                                    color: 'var(--color-on-surface)',
                                    margin: 0,
                                }}>
                                {title}
                            </h3>
                            <p style={{ font: '400 14px/1.55 var(--font-body)', color: 'var(--color-on-surface-variant)', margin: 0 }}>
                                {body}
                            </p>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    )
}

/* ─────────── Testimonials ─────────── */
function Testimonials() {
    const items = [
        {
            quote: 'I sketched a string quartet on a train ride. Notion would have made me cry.',
            name: 'Maya Okafor',
            role: 'Composer, RNCM',
        },
        {
            quote: 'Finally, an editor where input feels like writing, not wrestling.',
            name: 'Daniel Park',
            role: 'Film scorer',
        },
        {
            quote: 'My students stop asking how to make a sharp and just write music.',
            name: 'Prof. Anya Reyes',
            role: 'Theory faculty',
        },
    ]
    return (
        <section style={{ padding: '88px 32px' }}>
            <div style={{ maxWidth: 1280, margin: '0 auto' }}>
                <div style={{ marginBottom: 48 }}>
                    <Eyebrow color="var(--color-secondary)">Hear it from them</Eyebrow>
                    <h2
                        style={{
                            fontFamily: 'var(--font-display)',
                            fontWeight: 700,
                            fontSize: 48,
                            lineHeight: 1,
                            letterSpacing: '-0.03em',
                            color: 'var(--color-on-surface)',
                            margin: '12px 0 0',
                            maxWidth: 640,
                        }}>
                        People who write a lot of notes.
                    </h2>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 24 }}>
                    {items.map((t, i) => (
                        <figure
                            key={i}
                            style={{
                                background: 'var(--color-surface-container-lowest)',
                                borderRadius: 12,
                                padding: 28,
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 20,
                                margin: 0,
                            }}>
                            <span
                                aria-hidden
                                style={{
                                    font: '700 56px/0.7 var(--font-serif)',
                                    color: 'var(--color-primary)',
                                }}>
                                "
                            </span>
                            <blockquote
                                style={{
                                    font: '400 17px/1.45 var(--font-serif)',
                                    fontStyle: 'italic',
                                    color: 'var(--color-on-surface)',
                                    margin: 0,
                                }}>
                                {t.quote}
                            </blockquote>
                            <figcaption style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 'auto' }}>
                                <span
                                    style={{
                                        width: 36,
                                        height: 36,
                                        borderRadius: 9999,
                                        background: 'var(--color-secondary-soft)',
                                        color: 'var(--color-on-secondary-soft)',
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        font: '600 14px/1 var(--font-display)',
                                    }}>
                                    {t.name
                                        .split(' ')
                                        .map((s) => s[0])
                                        .join('')}
                                </span>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                    <span style={{ font: '600 14px/1.2 var(--font-body)', color: 'var(--color-on-surface)' }}>
                                        {t.name}
                                    </span>
                                    <span style={{ font: '400 12px/1.2 var(--font-body)', color: 'var(--color-on-surface-variant)' }}>
                                        {t.role}
                                    </span>
                                </div>
                            </figcaption>
                        </figure>
                    ))}
                </div>
            </div>
        </section>
    )
}

/* ─────────── Pricing teaser ─────────── */
function PricingTeaser({ onGetStarted }) {
    const tiers = [
        {
            name: 'Tinkerer',
            price: 'Free',
            sub: 'forever',
            bullets: ['30 sec recording / day', 'Up to 3 active scores', 'Real-instrument playback', 'Export to PDF & MusicXML'],
            cta: 'Start tinkering',
            emphasis: false,
        },
        {
            name: 'Hobbyist',
            price: '$15',
            sub: '/ month',
            bullets: ['10 min recording / day', 'Unlimited scores', 'Full instrument library', 'Lossless audio export', 'Priority support'],
            cta: 'Try Hobbyist free',
            emphasis: true,
        },
        {
            name: 'Professional',
            price: '$99',
            sub: '/ month',
            bullets: [
                'Unlimited recording',
                'Everything in Hobbyist',
                'Engraver-grade layout controls',
                'Parts & score generation',
                'Collaborator seats',
            ],
            cta: 'Go Professional',
            emphasis: false,
        },
    ]
    return (
        <section id="pricing" style={{ padding: '88px 32px', background: 'var(--color-surface-container-lowest)' }}>
            <div style={{ maxWidth: 1280, margin: '0 auto' }}>
                <div style={{ marginBottom: 48, textAlign: 'center' }}>
                    <Eyebrow color="var(--color-primary)">Pricing</Eyebrow>
                    <h2
                        style={{
                            fontFamily: 'var(--font-display)',
                            fontWeight: 700,
                            fontSize: 48,
                            lineHeight: 1,
                            letterSpacing: '-0.03em',
                            color: 'var(--color-on-surface)',
                            margin: '12px auto 0',
                        }}>
                        Pick the size that fits.
                    </h2>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 24 }}>
                    {tiers.map((t) => (
                        <div
                            key={t.name}
                            style={{
                                // The one place a dark surface is allowed: a single emphasised tier on
                                // the marketing pricing surface. See README §Visual foundations
                                // “Marketing-emphasis surface” — not for in-app chrome.
                                background: t.emphasis ? 'var(--color-on-surface)' : 'var(--color-surface)',
                                color: t.emphasis ? 'var(--color-surface)' : 'var(--color-on-surface)',
                                borderRadius: 12,
                                padding: 28,
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 16,
                                boxShadow: t.emphasis ? 'var(--shadow-offset-3)' : 'none',
                            }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                <h3 style={{ font: '600 20px/1 var(--font-headline)', letterSpacing: '-0.01em', margin: 0 }}>{t.name}</h3>
                                {t.emphasis && (
                                    <span
                                        style={{
                                            font: '600 10px/1 var(--font-label)',
                                            textTransform: 'uppercase',
                                            letterSpacing: '0.12em',
                                            background: 'var(--color-secondary-container)',
                                            color: 'var(--color-on-secondary-container)',
                                            padding: '6px 10px',
                                            borderRadius: 9999,
                                        }}>
                                        Most picked
                                    </span>
                                )}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                                <span
                                    style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 40, letterSpacing: '-0.03em' }}>
                                    {t.price}
                                </span>
                                <span
                                    style={{
                                        font: '500 13px/1 var(--font-body)',
                                        color: t.emphasis ? 'var(--color-inverse-on-surface)' : 'var(--color-on-surface-variant)',
                                    }}>
                                    {t.sub}
                                </span>
                            </div>
                            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
                                {t.bullets.map((b) => (
                                    <li
                                        key={b}
                                        style={{
                                            display: 'flex',
                                            gap: 10,
                                            alignItems: 'flex-start',
                                            font: '400 14px/1.5 var(--font-body)',
                                        }}>
                                        <Icon
                                            name="check"
                                            size={16}
                                            color={t.emphasis ? 'var(--color-primary-container)' : 'var(--color-primary)'}
                                        />
                                        <span>{b}</span>
                                    </li>
                                ))}
                            </ul>
                            <div style={{ marginTop: 'auto', paddingTop: 8 }}>
                                {t.emphasis ? (
                                    <PrimaryButton emphasis="pop" fullWidth onClick={onGetStarted}>
                                        {t.cta}
                                    </PrimaryButton>
                                ) : (
                                    <SecondaryButton fullWidth onClick={onGetStarted}>
                                        {t.cta}
                                    </SecondaryButton>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    )
}

/* ─────────── Final CTA ─────────── */
function FinalCTA({ onGetStarted }) {
    return (
        <section style={{ padding: '96px 32px', position: 'relative', overflow: 'hidden' }}>
            <div
                style={{
                    position: 'absolute',
                    top: '50%',
                    left: '50%',
                    width: 540,
                    height: 540,
                    transform: 'translate(-50%, -50%)',
                    background: 'rgba(0,219,233,0.18)',
                    borderRadius: '50%',
                    filter: 'blur(120px)',
                    pointerEvents: 'none',
                }}
            />
            <div
                style={{
                    maxWidth: 760,
                    margin: '0 auto',
                    textAlign: 'center',
                    position: 'relative',
                    zIndex: 2,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 20,
                    alignItems: 'center',
                }}>
                <h2
                    style={{
                        fontFamily: 'var(--font-display)',
                        fontWeight: 700,
                        fontSize: 48,
                        lineHeight: 1,
                        letterSpacing: '-0.03em',
                        color: 'var(--color-on-surface)',
                        margin: 0,
                    }}>
                    The score is waiting.
                    <br />
                    <em style={{ fontFamily: 'var(--font-serif)', fontWeight: 400 }}>Go write it.</em>
                </h2>
                <p style={{ font: '400 17px/1.5 var(--font-body)', color: 'var(--color-on-surface-variant)', margin: 0, maxWidth: 520 }}>
                    Free to start. No credit card. Your first piece takes about a minute to set up.
                </p>
                <div style={{ marginTop: 8 }}>
                    <PrimaryButton size="lg" emphasis="pop" icon="arrow-right" onClick={onGetStarted}>
                        Start composing — it's free
                    </PrimaryButton>
                </div>
            </div>
        </section>
    )
}

Object.assign(window, { Landing })
