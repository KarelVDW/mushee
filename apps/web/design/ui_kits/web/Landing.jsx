// Landing page — marketing surface for new visitors.
// Layout mirrors production (src/app/LandingPage.tsx): nav → hero → how-it-works → features → pricing → final CTA → footer.

function Landing({ onSignIn, onGetStarted }) {
    return (
        <div
            data-screen-label="Landing"
            style={{ background: 'var(--color-surface)', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
            <LandingNav onSignIn={onSignIn} onGetStarted={onGetStarted} />
            <LandingHero onSignIn={onSignIn} onGetStarted={onGetStarted} />
            <HowItWorks />
            <FeatureGrid />
            <PricingTeaser onGetStarted={onGetStarted} />
            <FinalCTA onGetStarted={onGetStarted} />
            <Footer />
            <CookieBanner />
        </div>
    )
}

/* ─────────── Cookie consent ───────────
   Mirrors production's GDPR model (src/components/CookieConsent.tsx):
   anonymous cookieless stats are always on; the opt-in only covers session
   replay + account-linked analytics. "Essential only" and "Accept all" carry
   equal visual weight, as the GDPR requires. */
function CookieBanner() {
    const [decided, setDecided] = useState(false)
    const [settingsOpen, setSettingsOpen] = useState(false)
    const [analyticsChoice, setAnalyticsChoice] = useState(false)

    const decide = (_analytics) => {
        setDecided(true)
        setSettingsOpen(false)
    }

    if (settingsOpen) {
        return (
            <DialogScrim onDismiss={() => setSettingsOpen(false)}>
                <DialogPanel
                    title="Cookie preferences"
                    subtitle="Choose what Sheemu may use. You can change this any time via 'Cookie settings' in the footer."
                    onClose={() => setSettingsOpen(false)}
                    width={520}
                    footer={
                        <>
                            <TertiaryButton onClick={() => decide(false)}>Essential only</TertiaryButton>
                            <PrimaryButton onClick={() => decide(analyticsChoice)}>Save preferences</PrimaryButton>
                        </>
                    }>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, paddingBottom: 8 }}>
                        {[
                            [
                                'Essential',
                                'Always on',
                                "Keeps you signed in and remembers this cookie choice. Sheemu doesn't work without these.",
                            ],
                            [
                                'Anonymous statistics',
                                'Always on · no cookies',
                                'Counts pages and feature use without cookies or anything stored on your device — never linked to who you are (PostHog, hosted in the EU).',
                            ],
                        ].map(([title, badge, body]) => (
                            <div
                                key={title}
                                style={{
                                    background: 'var(--color-surface-container-low)',
                                    borderRadius: 8,
                                    padding: '14px 16px',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: 8,
                                }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                                    <span style={{ font: '600 14px/1.3 var(--font-body)', color: 'var(--color-on-surface)' }}>
                                        {title}
                                    </span>
                                    <span
                                        style={{
                                            font: '600 10px/1 var(--font-label)',
                                            letterSpacing: '0.12em',
                                            textTransform: 'uppercase',
                                            color: 'var(--color-on-surface-variant)',
                                        }}>
                                        {badge}
                                    </span>
                                </div>
                                <p style={{ font: '400 13px/1.5 var(--font-body)', color: 'var(--color-on-surface-variant)', margin: 0 }}>
                                    {body}
                                </p>
                            </div>
                        ))}
                        <div
                            style={{
                                background: 'var(--color-surface-container-low)',
                                borderRadius: 8,
                                padding: '14px 16px',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 8,
                            }}>
                            <label
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    gap: 12,
                                    cursor: 'pointer',
                                }}>
                                <span style={{ font: '600 14px/1.3 var(--font-body)', color: 'var(--color-on-surface)' }}>
                                    Session replay &amp; linked analytics
                                </span>
                                <input
                                    type="checkbox"
                                    checked={analyticsChoice}
                                    onChange={(e) => setAnalyticsChoice(e.target.checked)}
                                    style={{ accentColor: 'var(--color-primary)' }}
                                />
                            </label>
                            <p style={{ font: '400 13px/1.5 var(--font-body)', color: 'var(--color-on-surface-variant)', margin: 0 }}>
                                Lets us watch anonymized replays of rough edges and connect usage to your account id so we can debug your
                                issues. Uses one PostHog cookie. Off by default.
                            </p>
                        </div>
                        <p style={{ font: '400 12px/1.5 var(--font-body)', color: 'var(--color-on-surface-variant)', margin: 0 }}>
                            Details in our{' '}
                            <a href="#" style={{ color: 'var(--color-primary)', textDecoration: 'underline' }}>
                                privacy policy
                            </a>
                            .
                        </p>
                    </div>
                </DialogPanel>
            </DialogScrim>
        )
    }

    if (decided) return null

    return (
        <div
            role="dialog"
            aria-label="Cookie consent"
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
                    Sheemu uses essential cookies to keep you signed in, plus cookieless, anonymous usage stats. With your permission
                    we'd also use session replay to improve the editor — that's entirely up to you.{' '}
                    <a href="#" style={{ color: 'var(--color-primary)', textDecoration: 'underline' }}>
                        Learn more
                    </a>
                    .
                </p>
            </div>
            {/* "Essential only" and "Accept all" carry equal visual weight. Only "Customize" steps back a level. */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, flexWrap: 'wrap' }}>
                <TertiaryButton onClick={() => setSettingsOpen(true)}>Customize</TertiaryButton>
                <SecondaryButton onClick={() => decide(false)}>Essential only</SecondaryButton>
                <SecondaryButton onClick={() => decide(true)}>Accept all</SecondaryButton>
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
                    <PrimaryButton icon="arrow-right" onClick={onGetStarted}>
                        Start free
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
                    <Eyebrow color="var(--color-primary)">Live audio-to-notation</Eyebrow>
                    <h1
                        style={{
                            fontFamily: 'var(--font-display)',
                            fontWeight: 700,
                            fontSize: 72,
                            lineHeight: 0.95,
                            letterSpacing: '-0.04em',
                            color: 'var(--color-on-surface)',
                            margin: 0,
                        }}>
                        The fastest way to get a melody
                        <br />
                        <em style={{ fontFamily: 'var(--font-serif)', fontWeight: 400 }}>on the page.</em>
                    </h1>
                    <p
                        style={{
                            font: '400 18px/1.5 var(--font-body)',
                            color: 'var(--color-on-surface-variant)',
                            margin: 0,
                            maxWidth: 480,
                        }}>
                        Hum it, sing it, or play it — Sheemu listens and writes clean sheet music in front of your eyes. No note-by-note
                        clicking, no wrestling with menus. Just press record.
                    </p>
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
                        <PrimaryButton size="lg" emphasis="pop" icon="arrow-right" onClick={onGetStarted}>
                            Start free
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

/* ─────────── How it works ─────────── */
function HowItWorks() {
    const steps = [
        ['01', 'Press record', 'Open a score, set your tempo, and hit record. Sheemu counts you in and starts listening — only while you record.'],
        ['02', 'Play or sing', 'Any instrument, or just your voice. The melody lands on the staff as notation while you play it, measure by measure.'],
        ['03', 'Polish & keep', "Fix a note with a keystroke, tweak rhythm and key, and hear it back with real instrument sounds. It's saved as you go."],
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
                        From melody to sheet music in one take.
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
                    Everything you need to catch an idea before it evaporates — nothing you don't.
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 24 }}>
                    {[
                        [
                            'mic',
                            'Live transcription',
                            'Sing, whistle, or play — pitch and rhythm are detected in real time and written as proper notation, not a piano roll.',
                        ],
                        [
                            'music',
                            'Real engraving',
                            'Spacing, beaming, accidentals, and ties follow real engraving rules, so the page always looks like sheet music should.',
                        ],
                        [
                            'keyboard',
                            'Keyboard-first editing',
                            'Every correction is a keystroke away: durations, accidentals, octaves. Customize the shortcuts to fit your hands.',
                        ],
                        [
                            'audio-lines',
                            'Hear it back',
                            'Play your score with lifelike instrument samples to proof your work by ear before anyone else does.',
                        ],
                        [
                            'cloud',
                            'Saved as you go',
                            'Every change is stored instantly. Close the tab mid-phrase and pick up on another device without losing a note.',
                        ],
                        [
                            'shield',
                            'Yours, privately',
                            'Your music belongs to you. Recordings stay private to your account — never published, shared, or sold — and vanish when you delete it.',
                        ],
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

/* ─────────── Pricing ───────────
   Mirrors production (src/app/LandingPage.tsx + src/lib/plans.ts). Tiers and
   entitlements live in the database and are served by GET /plans; this static
   catalogue is display decoration and must stay in sync with the seeds.
   Never say "unlimited" — every sold tier has a daily recording budget. */
const LANDING_TIERS = [
    {
        name: 'Sketch',
        price: 'Free',
        sub: 'forever',
        bullets: ['3 min of recording / day', 'Up to 5 scores', 'Live audio-to-notation', 'Full editor & playback'],
        cta: 'Start sketching',
        emphasis: false,
    },
    {
        name: 'Songwriter',
        price: '$9',
        sub: '/ month · $90/yr',
        bullets: ['20 min of recording / day', 'As many scores as you like', 'Everything in Sketch', 'Early access to new features'],
        cta: 'Go Songwriter',
        emphasis: true,
    },
    {
        name: 'Studio',
        price: '$19',
        sub: '/ month · $190/yr',
        bullets: ['3 h of recording / day', 'As many scores as you like', 'Everything in Songwriter', 'Priority support'],
        cta: 'Go Studio',
        emphasis: false,
    },
]

// The professional tier: present enough to anchor the ladder, slim enough not
// to compete with the consumer cards.
const LANDING_PRO_TIER = {
    name: 'Arranger',
    icon: 'crown',
    taglineLower: 'for transcription as a job',
    price: '$49',
    sub: '/ month · $490/yr',
    line: '8 h of recording / day · everything in Studio · direct support from the maker',
}

// One-time packs — deliberately the secondary offer, one click away.
const LANDING_PACKS = [
    ['Single', '$6', '15 min of recording · One song, with plenty of retakes.'],
    ['EP', '$15', '45 min of recording · A weekend writing session.'],
    ['Album', '$39', '150 min of recording · A whole project, start to finish.'],
]

function PricingTeaser({ onGetStarted }) {
    const [packsOpen, setPacksOpen] = useState(false)
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
                        Pay for recording time, nothing else.
                    </h2>
                    <p
                        style={{
                            font: '400 15px/1.5 var(--font-body)',
                            color: 'var(--color-on-surface-variant)',
                            maxWidth: 560,
                            margin: '16px auto 0',
                        }}>
                        Every plan gets the full editor, live audio-to-notation, and playback. The plans differ in how much you can
                        record per day — and Sketch keeps a shelf of up to five scores.
                    </p>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 24 }}>
                    {LANDING_TIERS.map((t) => (
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
                                            background: 'var(--color-secondary-soft)',
                                            color: 'var(--color-on-secondary-soft)',
                                            padding: '6px 10px',
                                            borderRadius: 9999,
                                        }}>
                                        Best value
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
                                    <PrimaryButton fullWidth onClick={onGetStarted}>
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

                {/* Professional tier — slim secondary card */}
                <div
                    style={{
                        marginTop: 24,
                        maxWidth: 760,
                        marginLeft: 'auto',
                        marginRight: 'auto',
                        background: 'var(--color-surface)',
                        borderRadius: 12,
                        padding: '20px 24px',
                        display: 'flex',
                        flexWrap: 'wrap',
                        alignItems: 'center',
                        gap: 16,
                    }}>
                    <span
                        style={{
                            width: 40,
                            height: 40,
                            borderRadius: 9999,
                            flexShrink: 0,
                            background: 'var(--color-secondary-soft)',
                            color: 'var(--color-on-secondary-soft)',
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}>
                        <Icon name={LANDING_PRO_TIER.icon} size={18} />
                    </span>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 200 }}>
                        <span style={{ font: '600 16px/1.2 var(--font-headline)', color: 'var(--color-on-surface)' }}>
                            {LANDING_PRO_TIER.name} — {LANDING_PRO_TIER.taglineLower}
                        </span>
                        <span style={{ font: '400 13px/1.4 var(--font-body)', color: 'var(--color-on-surface-variant)' }}>
                            {LANDING_PRO_TIER.line}
                        </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                        <span
                            style={{
                                fontFamily: 'var(--font-mono)',
                                fontWeight: 600,
                                fontSize: 22,
                                lineHeight: 1,
                                letterSpacing: '-0.01em',
                                color: 'var(--color-on-surface)',
                            }}>
                            {LANDING_PRO_TIER.price}
                        </span>
                        <span style={{ font: '500 12px/1 var(--font-body)', color: 'var(--color-on-surface-variant)' }}>
                            {LANDING_PRO_TIER.sub}
                        </span>
                    </div>
                    <SecondaryButton onClick={onGetStarted}>Go {LANDING_PRO_TIER.name}</SecondaryButton>
                </div>

                {/* One-time packs, one click away — the subscriptions above stay the offer. */}
                <div style={{ marginTop: 32, textAlign: 'center' }}>
                    <button
                        type="button"
                        onClick={() => setPacksOpen((v) => !v)}
                        aria-expanded={packsOpen}
                        style={{
                            border: 0,
                            background: 'transparent',
                            padding: 0,
                            cursor: 'pointer',
                            font: '500 14px/1.3 var(--font-body)',
                            color: 'var(--color-primary)',
                            textDecoration: 'underline',
                        }}>
                        Not ready for a subscription? One-time minute packs, from $6
                    </button>
                    {packsOpen && (
                        <div
                            style={{
                                marginTop: 20,
                                maxWidth: 760,
                                marginLeft: 'auto',
                                marginRight: 'auto',
                                display: 'grid',
                                gridTemplateColumns: 'repeat(3, 1fr)',
                                gap: 16,
                                textAlign: 'left',
                            }}>
                            {LANDING_PACKS.map(([name, price, line]) => (
                                <div
                                    key={name}
                                    style={{
                                        background: 'var(--color-surface)',
                                        borderRadius: 12,
                                        padding: 20,
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: 6,
                                    }}>
                                    <span style={{ font: '600 15px/1.2 var(--font-headline)', color: 'var(--color-on-surface)' }}>
                                        {name}
                                    </span>
                                    <span
                                        style={{
                                            fontFamily: 'var(--font-mono)',
                                            fontWeight: 600,
                                            fontSize: 20,
                                            lineHeight: 1,
                                            letterSpacing: '-0.01em',
                                            color: 'var(--color-on-surface)',
                                        }}>
                                        {price}
                                    </span>
                                    <span style={{ font: '400 13px/1.4 var(--font-body)', color: 'var(--color-on-surface-variant)' }}>
                                        {line}
                                    </span>
                                </div>
                            ))}
                            <p
                                style={{
                                    gridColumn: '1 / -1',
                                    font: '400 12px/1.5 var(--font-body)',
                                    color: 'var(--color-on-surface-variant)',
                                    textAlign: 'center',
                                    margin: 0,
                                }}>
                                Packs never expire and need a free account — buy them any time from Settings.
                            </p>
                        </div>
                    )}
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
                    That melody in your head?
                    <br />
                    <em style={{ fontFamily: 'var(--font-serif)', fontWeight: 400 }}>It takes one take.</em>
                </h2>
                <p style={{ font: '400 17px/1.5 var(--font-body)', color: 'var(--color-on-surface-variant)', margin: 0, maxWidth: 520 }}>
                    Free to start. No credit card. Your first recording is on the page in under a minute.
                </p>
                <div style={{ marginTop: 8 }}>
                    <PrimaryButton size="lg" emphasis="pop" icon="arrow-right" onClick={onGetStarted}>
                        Start free
                    </PrimaryButton>
                </div>
            </div>
        </section>
    )
}

Object.assign(window, { Landing })
