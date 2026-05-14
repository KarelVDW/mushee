// Auth — split-panel sign-in / sign-up.
function AuthCard({ mode = 'signin', onSwitch, onSubmit }) {
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [name, setName] = useState('')
    const [showPw, setShowPw] = useState(false)
    const isSignup = mode === 'signup'

    return (
        <main
            data-screen-label={`Auth · ${mode}`}
            style={{
                width: '100%',
                maxWidth: 920,
                margin: '0 auto',
                background: 'var(--color-surface-container-lowest)',
                borderRadius: 16,
                boxShadow: '0 0 19px 0 rgba(45,47,47,0.06)',
                display: 'flex',
                overflow: 'hidden',
                minHeight: 580,
                position: 'relative',
            }}>
            {/* Decorative cyan haze */}
            <div
                style={{
                    position: 'absolute',
                    top: '-20%',
                    right: '-10%',
                    width: '50%',
                    height: '50%',
                    background: 'rgba(0,219,233,0.18)',
                    borderRadius: '50%',
                    filter: 'blur(96px)',
                    pointerEvents: 'none',
                }}
            />
            {/* Brand panel */}
            <section
                style={{
                    width: '42%',
                    background: 'var(--color-surface-container-high)',
                    padding: 48,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    position: 'relative',
                    overflow: 'hidden',
                }}>
                <Wordmark size={32} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <h1
                        style={{
                            fontFamily: 'var(--font-display)',
                            fontWeight: 400,
                            fontStyle: 'italic',
                            fontSize: 48,
                            lineHeight: 1,
                            letterSpacing: '-0.02em',
                            color: 'var(--color-on-surface)',
                            margin: 0,
                        }}>
                        {isSignup ? (
                            <>
                                Compose
                                <br />
                                without friction.
                            </>
                        ) : (
                            <>
                                Welcome
                                <br />
                                back.
                            </>
                        )}
                    </h1>
                    <p
                        style={{
                            font: '400 14px/1.5 var(--font-body)',
                            color: 'var(--color-on-surface-variant)',
                            maxWidth: 280,
                            margin: 0,
                        }}>
                        A simple, fast score editor for the music in your head.
                    </p>
                </div>
            </section>

            {/* Form panel */}
            <section
                style={{
                    flex: 1,
                    padding: 56,
                    display: 'flex',
                    flexDirection: 'column',
                    position: 'relative',
                    zIndex: 2,
                }}>
                <div style={{ maxWidth: 360, width: '100%', margin: '0 auto', flex: 1, display: 'flex', flexDirection: 'column' }}>
                    <div
                        style={{
                            display: 'flex',
                            alignItems: 'flex-end',
                            gap: 26,
                            borderBottom: '1px solid rgba(172,173,173,0.2)',
                            paddingBottom: 8,
                            marginBottom: 32,
                        }}>
                        {[
                            ['signin', 'Sign in'],
                            ['signup', 'Create account'],
                        ].map(([m, label]) => (
                            <button
                                key={m}
                                onClick={() => onSwitch(m)}
                                style={{
                                    background: 'transparent',
                                    border: 0,
                                    cursor: 'pointer',
                                    font: '500 14px/1 var(--font-body)',
                                    color: mode === m ? 'var(--color-on-surface)' : 'var(--color-on-surface-variant)',
                                    borderBottom: mode === m ? '2px solid var(--color-primary-container)' : '2px solid transparent',
                                    marginBottom: -9,
                                    paddingBottom: 8,
                                    whiteSpace: 'nowrap',
                                    flexShrink: 0,
                                }}>
                                {label}
                            </button>
                        ))}
                    </div>

                    <form
                        onSubmit={(e) => {
                            e.preventDefault()
                            onSubmit?.()
                        }}
                        style={{ display: 'flex', flexDirection: 'column', gap: 20, flex: 1 }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 18, flex: 1, justifyContent: 'center' }}>
                            {isSignup && <TextField label="Your name" value={name} onChange={setName} placeholder="Anya Mokri" />}
                            <TextField label="Email" value={email} onChange={setEmail} placeholder="you@email.com" />
                            <TextField
                                label="Password"
                                value={password}
                                onChange={setPassword}
                                type={showPw ? 'text' : 'password'}
                                placeholder="••••••••••••"
                                rightSlot={
                                    <button
                                        type="button"
                                        onClick={() => setShowPw(!showPw)}
                                        aria-label="Toggle password visibility"
                                        style={{
                                            background: 'transparent',
                                            border: 0,
                                            color: 'var(--color-outline)',
                                            cursor: 'pointer',
                                            padding: 4,
                                            display: 'inline-flex',
                                        }}>
                                        <Icon name={showPw ? 'eye-off' : 'eye'} size={18} />
                                    </button>
                                }
                            />
                            {!isSignup && (
                                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: -8 }}>
                                    <TertiaryButton onClick={() => onSwitch('reset')}>Forgot password?</TertiaryButton>
                                </div>
                            )}
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingTop: 8 }}>
                            <PrimaryButton size="lg" type="submit" emphasis="pop" fullWidth>
                                {isSignup ? 'Create account' : 'Sign in'}
                            </PrimaryButton>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span style={{ font: '400 13px/1 var(--font-body)', color: 'var(--color-on-surface-variant)' }}>
                                    {isSignup ? 'Already have an account?' : 'New here?'}
                                </span>
                                <TertiaryButton onClick={() => onSwitch(isSignup ? 'signin' : 'signup')}>
                                    {isSignup ? 'Sign in' : 'Create one'}
                                </TertiaryButton>
                            </div>
                        </div>
                    </form>
                </div>
            </section>
        </main>
    )
}

// Password reset — four stages on one card.
//   request   → enter email, "Send reset link"
//   sent      → "Check your email" confirmation w/ resend
//   set-new   → set + confirm new password (from the emailed link)
//   done      → success, back to sign in
function PasswordResetCard({ onBackToSignIn }) {
    const [stage, setStage] = useState('request')
    const [email, setEmail] = useState('')
    const [pw, setPw] = useState('')
    const [pw2, setPw2] = useState('')
    const [showPw, setShowPw] = useState(false)
    const [resent, setResent] = useState(false)

    const pwScore = scorePassword(pw)
    const pwMatch = pw.length > 0 && pw === pw2
    const canSetNew = pwScore >= 2 && pwMatch

    // Built-in stepper so the kit shows all four stages without leaving the card.
    const STAGES = ['request', 'sent', 'set-new', 'done']
    const stageIdx = STAGES.indexOf(stage)

    return (
        <main
            data-screen-label={`Auth · reset · ${stage}`}
            style={{
                width: '100%',
                maxWidth: 920,
                margin: '0 auto',
                background: 'var(--color-surface-container-lowest)',
                borderRadius: 16,
                boxShadow: '0 0 19px 0 rgba(45,47,47,0.06)',
                display: 'flex',
                overflow: 'hidden',
                minHeight: 580,
                position: 'relative',
            }}>
            {/* Decorative cyan haze */}
            <div
                style={{
                    position: 'absolute',
                    top: '-20%',
                    right: '-10%',
                    width: '50%',
                    height: '50%',
                    background: 'rgba(0,219,233,0.18)',
                    borderRadius: '50%',
                    filter: 'blur(96px)',
                    pointerEvents: 'none',
                }}
            />
            {/* Brand panel */}
            <section
                style={{
                    width: '42%',
                    background: 'var(--color-surface-container-high)',
                    padding: 48,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    position: 'relative',
                    overflow: 'hidden',
                }}>
                <Wordmark size={32} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <h1
                        style={{
                            fontFamily: 'var(--font-display)',
                            fontWeight: 400,
                            fontStyle: 'italic',
                            fontSize: 48,
                            lineHeight: 1,
                            letterSpacing: '-0.02em',
                            color: 'var(--color-on-surface)',
                            margin: 0,
                        }}>
                        {stage === 'done' ? (
                            <>
                                You're
                                <br />
                                back in.
                            </>
                        ) : (
                            <>
                                Reset your
                                <br />
                                password.
                            </>
                        )}
                    </h1>
                    <p
                        style={{
                            font: '400 14px/1.5 var(--font-body)',
                            color: 'var(--color-on-surface-variant)',
                            maxWidth: 280,
                            margin: 0,
                        }}>
                        {stage === 'request' && "We'll email you a link to set a new one. Takes a minute."}
                        {stage === 'sent' && 'Open the link from your inbox to continue.'}
                        {stage === 'set-new' && "Pick something memorable. We won't make you change it again."}
                        {stage === 'done' && 'Your new password is saved. Welcome back.'}
                    </p>
                </div>
            </section>

            {/* Form panel */}
            <section
                style={{
                    flex: 1,
                    padding: 56,
                    display: 'flex',
                    flexDirection: 'column',
                    position: 'relative',
                    zIndex: 2,
                }}>
                <div style={{ maxWidth: 360, width: '100%', margin: '0 auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 24 }}>
                    {/* Stage strip */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {STAGES.map((s, i) => (
                            <button
                                key={s}
                                type="button"
                                onClick={() => setStage(s)}
                                aria-label={`Show stage ${i + 1}`}
                                style={{
                                    height: 4,
                                    flex: 1,
                                    borderRadius: 4,
                                    border: 0,
                                    padding: 0,
                                    background: i <= stageIdx ? 'var(--color-primary-container)' : 'var(--color-surface-container)',
                                    cursor: 'pointer',
                                }}
                            />
                        ))}
                        <Eyebrow style={{ marginLeft: 8 }}>
                            {stageIdx + 1} of {STAGES.length}
                        </Eyebrow>
                    </div>

                    {stage === 'request' && (
                        <form
                            onSubmit={(e) => {
                                e.preventDefault()
                                if (email) setStage('sent')
                            }}
                            style={{ display: 'flex', flexDirection: 'column', gap: 20, flex: 1 }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1, justifyContent: 'center' }}>
                                <ModalTitle>Forgot your password?</ModalTitle>
                                <SubHeadline>Enter the email on your account and we'll send a reset link.</SubHeadline>
                                <div style={{ marginTop: 12 }}>
                                    <TextField label="Email" value={email} onChange={setEmail} placeholder="you@email.com" autoFocus />
                                </div>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingTop: 8 }}>
                                <PrimaryButton size="lg" type="submit" emphasis="pop" fullWidth disabled={!email}>
                                    Send reset link
                                </PrimaryButton>
                                <div style={{ display: 'flex', justifyContent: 'center' }}>
                                    <TertiaryButton onClick={onBackToSignIn}>← Back to sign in</TertiaryButton>
                                </div>
                            </div>
                        </form>
                    )}

                    {stage === 'sent' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, flex: 1 }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, flex: 1, justifyContent: 'center' }}>
                                <div
                                    style={{
                                        width: 56,
                                        height: 56,
                                        borderRadius: 9999,
                                        background: 'var(--color-primary-soft)',
                                        color: 'var(--color-on-primary-soft)',
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                    }}>
                                    <Icon name="mail" size={28} />
                                </div>
                                <ModalTitle>Check your email.</ModalTitle>
                                <SubHeadline>
                                    We sent a reset link to{' '}
                                    <strong style={{ color: 'var(--color-on-surface)' }}>{email || 'your address'}</strong>. The link is
                                    good for the next 30 minutes.
                                </SubHeadline>
                                <span style={{ font: '400 13px/1.5 var(--font-body)', color: 'var(--color-on-surface-variant)' }}>
                                    Don't see it? Check your spam folder, or{' '}
                                    <button
                                        type="button"
                                        onClick={() => setResent(true)}
                                        style={{
                                            background: 'transparent',
                                            border: 0,
                                            padding: 0,
                                            color: 'var(--color-primary)',
                                            cursor: 'pointer',
                                            font: 'inherit',
                                            textDecoration: 'underline',
                                        }}>
                                        {resent ? 'sent again ✓' : 'resend the link'}
                                    </button>
                                    .
                                </span>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingTop: 8 }}>
                                <PrimaryButton size="lg" emphasis="pop" fullWidth onClick={() => setStage('set-new')}>
                                    I have the link — continue
                                </PrimaryButton>
                                <div style={{ display: 'flex', justifyContent: 'center' }}>
                                    <TertiaryButton onClick={() => setStage('request')}>← Use a different email</TertiaryButton>
                                </div>
                            </div>
                        </div>
                    )}

                    {stage === 'set-new' && (
                        <form
                            onSubmit={(e) => {
                                e.preventDefault()
                                if (canSetNew) setStage('done')
                            }}
                            style={{ display: 'flex', flexDirection: 'column', gap: 20, flex: 1 }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, flex: 1, justifyContent: 'center' }}>
                                <ModalTitle>Set a new password.</ModalTitle>
                                <SubHeadline>At least 8 characters, with a mix of letters and numbers.</SubHeadline>
                                <TextField
                                    label="New password"
                                    value={pw}
                                    onChange={setPw}
                                    type={showPw ? 'text' : 'password'}
                                    placeholder="••••••••••••"
                                    autoFocus
                                    rightSlot={
                                        <button
                                            type="button"
                                            onClick={() => setShowPw(!showPw)}
                                            aria-label="Toggle password visibility"
                                            style={{
                                                background: 'transparent',
                                                border: 0,
                                                color: 'var(--color-outline)',
                                                cursor: 'pointer',
                                                padding: 4,
                                                display: 'inline-flex',
                                            }}>
                                            <Icon name={showPw ? 'eye-off' : 'eye'} size={18} />
                                        </button>
                                    }
                                />
                                {/* Strength meter */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: -8 }}>
                                    {[0, 1, 2, 3].map((i) => (
                                        <div
                                            key={i}
                                            style={{
                                                height: 3,
                                                flex: 1,
                                                borderRadius: 3,
                                                background:
                                                    i < pwScore
                                                        ? pwScore <= 1
                                                            ? 'var(--color-error-container)'
                                                            : pwScore === 2
                                                              ? 'var(--color-secondary-soft)'
                                                              : 'var(--color-primary-container)'
                                                        : 'var(--color-surface-container)',
                                                transition: 'background 180ms var(--ease)',
                                            }}
                                        />
                                    ))}
                                    <Eyebrow style={{ marginLeft: 4 }}>{PW_LABELS[pwScore]}</Eyebrow>
                                </div>
                                <TextField
                                    label="Confirm password"
                                    value={pw2}
                                    onChange={setPw2}
                                    type={showPw ? 'text' : 'password'}
                                    placeholder="••••••••••••"
                                />
                                {pw2.length > 0 && !pwMatch && (
                                    <span style={{ font: '500 12px/1.4 var(--font-body)', color: 'var(--color-error)' }}>
                                        Passwords don't match yet.
                                    </span>
                                )}
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingTop: 8 }}>
                                <PrimaryButton size="lg" type="submit" emphasis="pop" fullWidth disabled={!canSetNew}>
                                    Save new password
                                </PrimaryButton>
                                <div style={{ display: 'flex', justifyContent: 'center' }}>
                                    <TertiaryButton onClick={onBackToSignIn}>← Cancel</TertiaryButton>
                                </div>
                            </div>
                        </form>
                    )}

                    {stage === 'done' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, flex: 1 }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, flex: 1, justifyContent: 'center' }}>
                                <div
                                    style={{
                                        width: 56,
                                        height: 56,
                                        borderRadius: 9999,
                                        background: 'var(--color-primary-container)',
                                        color: 'var(--color-on-primary-container)',
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                    }}>
                                    <Icon name="check" size={28} />
                                </div>
                                <ModalTitle>Password updated.</ModalTitle>
                                <SubHeadline>You can sign in with your new password now.</SubHeadline>
                            </div>
                            <div style={{ paddingTop: 8 }}>
                                <PrimaryButton size="lg" emphasis="pop" fullWidth icon="arrow-right" onClick={onBackToSignIn}>
                                    Sign in
                                </PrimaryButton>
                            </div>
                        </div>
                    )}
                </div>
            </section>
        </main>
    )
}

// Tiny password strength heuristic — length + character classes.
const PW_LABELS = ['Too short', 'Weak', 'OK', 'Strong', 'Strong']
function scorePassword(pw) {
    if (!pw) return 0
    let s = 0
    if (pw.length >= 8) s++
    if (pw.length >= 12) s++
    if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++
    if (/\d/.test(pw) || /[^A-Za-z0-9]/.test(pw)) s++
    return Math.min(s, 4)
}

Object.assign(window, { AuthCard, PasswordResetCard, scorePassword, PW_LABELS })
