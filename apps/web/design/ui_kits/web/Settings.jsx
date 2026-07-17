// User settings — profile and account.

// Mirrors the catalogue in Onboarding. Display decoration only: in production
// the tiers (names, prices, budgets, caps) come from the database via
// GET /plans, and the live subscription state from the billing API. Never say
// "unlimited" — every sold tier has a daily recording budget.
const SETTINGS_PLAN_TIERS = [
    {
        id: 'free',
        name: 'Sketch',
        icon: 'feather',
        tagline: 'For trying things out',
        priceMonthly: 0,
        priceYearly: 0,
        dailyLimitSec: 180,
        features: ['3 min of recording / day', 'Up to 5 scores', 'Live audio-to-notation', 'Full editor & playback'],
    },
    {
        id: 'pro',
        name: 'Songwriter',
        icon: 'sparkles',
        tagline: 'For daily writers',
        priceMonthly: 9,
        priceYearly: 90,
        dailyLimitSec: 1200,
        features: ['20 min of recording / day', 'As many scores as you like', 'Everything in Sketch', 'Early access to new features'],
    },
    {
        id: 'studio',
        name: 'Studio',
        icon: 'gem',
        tagline: 'For heavy sessions',
        priceMonthly: 19,
        priceYearly: 190,
        dailyLimitSec: 10800,
        features: ['3 h of recording / day', 'As many scores as you like', 'Everything in Songwriter', 'Priority support'],
    },
    {
        id: 'arranger',
        name: 'Arranger',
        icon: 'crown',
        tagline: 'For transcription as a job',
        priceMonthly: 49,
        priceYearly: 490,
        dailyLimitSec: 28800,
        features: ['8 h of recording / day', 'As many scores as you like', 'Everything in Studio', 'Direct support from the maker'],
    },
]

// One-time recording-minute packs — display catalogue only (the charged
// amounts come from the Polar pack products on the API). Deliberately priced
// above the subscriptions' per-minute rate: packs serve the once-in-a-while
// user, never expire, and are spent only after the daily budget runs out.
const SETTINGS_CREDIT_PACKS = [
    {
        id: 'single',
        name: 'Single',
        minutes: 15,
        price: 6,
        blurb: 'One song, with plenty of retakes.',
        compare: 'Songwriter gives you 20 min every day for $3 more a month.',
    },
    {
        id: 'ep',
        name: 'EP',
        minutes: 45,
        price: 15,
        blurb: 'A weekend writing session.',
        compare: 'Roughly 7 weeks of Songwriter costs the same.',
    },
    {
        id: 'album',
        name: 'Album',
        minutes: 150,
        price: 39,
        blurb: 'A whole project, start to finish.',
        compare: 'Four months of Songwriter costs the same.',
    },
]

function settingsPlanPrice(plan, billing) {
    if (plan.priceMonthly === 0) return 'Free'
    if (billing === 'yearly') {
        const m = (plan.priceYearly / 12).toFixed(plan.priceYearly % 12 === 0 ? 0 : 2)
        return `$${m}/mo · billed yearly`
    }
    return `$${plan.priceMonthly}/mo`
}

// Change-plan dialog — lets the user pick a new tier and hands off to Polar
// (upgrades from free go through checkout; paid-to-paid switches and
// cancellations are applied in place through the API).
function ChangePlanDialog({ currentPlanId, currentBilling, onCancel, onChanged, onShowPacks }) {
    const [selected, setSelected] = useState(currentPlanId)
    const [billing, setBilling] = useState(currentBilling)
    const [phase, setPhase] = useState('choose') // 'choose' | 'redirecting' | 'done' | 'error'
    const [errorMsg, setErrorMsg] = useState('')

    const currentPlan = SETTINGS_PLAN_TIERS.find((p) => p.id === currentPlanId)
    const nextPlan = SETTINGS_PLAN_TIERS.find((p) => p.id === selected)
    const isSame = selected === currentPlanId && billing === currentBilling
    const isDowngrade = nextPlan.priceMonthly < currentPlan.priceMonthly
    const isCancel = nextPlan.id === 'free' && currentPlan.id !== 'free'

    const apply = async () => {
        if (isSame) return
        // Real Polar wiring (see src/app/settings/ChangePlanDialog.tsx):
        // - free/beta → paid: POST /billing/checkout, then redirect to Polar's page.
        // - paid → other paid tier/cadence: POST /billing/change (prorated in place).
        // - paid → free: POST /billing/cancel (keeps access until the period ends).
        if (isDowngrade || isCancel) {
            setPhase('redirecting')
            try {
                await new Promise((r) => setTimeout(r, 900))
                setPhase('done')
                setTimeout(() => onChanged({ planId: selected, billing }), 900)
            } catch (e) {
                setErrorMsg(e.message || "Couldn't reach Polar.")
                setPhase('error')
            }
            return
        }
        // Upgrade: hand off to Polar's hosted checkout; the success return
        // lands on /settings?checkout=success.
        setPhase('redirecting')
        try {
            await new Promise((r) => setTimeout(r, 1400))
            setPhase('done')
            setTimeout(() => onChanged({ planId: selected, billing }), 900)
        } catch (e) {
            setErrorMsg(e.message || "Couldn't reach Polar.")
            setPhase('error')
        }
    }

    const ctaLabel = isSame
        ? 'No change'
        : isCancel
          ? 'Cancel subscription'
          : isDowngrade
            ? `Switch to ${nextPlan.name}`
            : 'Continue to Polar checkout'

    return (
        <DialogScrim onDismiss={phase === 'redirecting' || phase === 'done' ? undefined : onCancel}>
            <DialogPanel
                title={
                    phase === 'done'
                        ? isCancel
                            ? 'Cancellation scheduled.'
                            : 'Plan updated.'
                        : phase === 'redirecting'
                          ? isDowngrade || isCancel
                              ? 'Updating your subscription…'
                              : 'Redirecting to Polar…'
                          : 'Change plan'
                }
                subtitle={
                    phase === 'done'
                        ? `You're now on ${nextPlan.name}.`
                        : phase === 'redirecting'
                          ? null
                          : 'Switch tiers, change billing cadence, or cancel. Payments are processed securely by Polar.'
                }
                onClose={phase === 'redirecting' || phase === 'done' ? undefined : onCancel}
                width={720}
                footer={
                    phase === 'choose' || phase === 'error' ? (
                        <>
                            <TertiaryButton onClick={onCancel}>Keep current plan</TertiaryButton>
                            <PrimaryButton
                                emphasis="pop"
                                disabled={isSame}
                                danger={isCancel}
                                icon={!isDowngrade && !isCancel ? 'external-link' : undefined}
                                onClick={apply}>
                                {ctaLabel}
                            </PrimaryButton>
                        </>
                    ) : null
                }>
                {phase === 'choose' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, paddingBottom: 8 }}>
                        <div
                            role="radiogroup"
                            aria-label="Billing cadence"
                            style={{
                                display: 'inline-flex',
                                padding: 3,
                                borderRadius: 9999,
                                background: 'var(--color-surface-container-low)',
                                alignSelf: 'flex-start',
                            }}>
                            {[
                                ['monthly', 'Monthly'],
                                ['yearly', 'Yearly · save 17%'],
                            ].map(([k, label]) => {
                                const active = billing === k
                                return (
                                    <button
                                        key={k}
                                        type="button"
                                        role="radio"
                                        aria-checked={active}
                                        onClick={() => setBilling(k)}
                                        style={{
                                            background: active ? 'var(--color-primary-container)' : 'transparent',
                                            color: active ? 'var(--color-on-primary-container)' : 'var(--color-on-surface-variant)',
                                            border: 0,
                                            padding: '7px 14px',
                                            borderRadius: 9999,
                                            cursor: 'pointer',
                                            font: '600 12px/1 var(--font-label)',
                                            transition: 'background 150ms var(--ease), color 150ms var(--ease)',
                                        }}>
                                        {label}
                                    </button>
                                )
                            })}
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                            {SETTINGS_PLAN_TIERS.map((p) => {
                                const active = selected === p.id
                                const isCurrent = p.id === currentPlanId && billing === currentBilling
                                return (
                                    <button
                                        key={p.id}
                                        onClick={() => setSelected(p.id)}
                                        aria-pressed={active}
                                        style={{
                                            position: 'relative',
                                            textAlign: 'left',
                                            background: active ? 'var(--color-primary-soft)' : 'var(--color-surface-container-lowest)',
                                            color: active ? 'var(--color-on-primary-soft)' : 'var(--color-on-surface)',
                                            border: 0,
                                            borderRadius: 12,
                                            padding: '16px 16px 14px',
                                            cursor: 'pointer',
                                            display: 'flex',
                                            flexDirection: 'column',
                                            gap: 10,
                                            boxShadow: active ? 'none' : 'var(--shadow-tonal)',
                                        }}>
                                        {isCurrent && (
                                            <span
                                                style={{
                                                    position: 'absolute',
                                                    top: -10,
                                                    right: 14,
                                                    background: 'var(--color-surface-container-high)',
                                                    color: 'var(--color-on-surface)',
                                                    font: '600 10px/1 var(--font-label)',
                                                    letterSpacing: '0.12em',
                                                    textTransform: 'uppercase',
                                                    padding: '6px 10px',
                                                    borderRadius: 9999,
                                                }}>
                                                Current
                                            </span>
                                        )}
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                            <Icon name={p.icon} size={18} />
                                            <span style={{ font: '600 14px/1.2 var(--font-body)' }}>{p.name}</span>
                                        </div>
                                        <span
                                            style={{
                                                fontFamily: 'var(--font-mono)',
                                                fontWeight: 600,
                                                fontSize: 22,
                                                lineHeight: 1,
                                                letterSpacing: '-0.01em',
                                            }}>
                                            {settingsPlanPrice(p, billing)}
                                        </span>
                                        <ul
                                            style={{
                                                listStyle: 'none',
                                                padding: 0,
                                                margin: 0,
                                                display: 'flex',
                                                flexDirection: 'column',
                                                gap: 6,
                                            }}>
                                            {p.features.map((f) => (
                                                <li
                                                    key={f}
                                                    style={{
                                                        display: 'flex',
                                                        alignItems: 'flex-start',
                                                        gap: 6,
                                                        font: '400 12px/1.4 var(--font-body)',
                                                    }}>
                                                    <span style={{ marginTop: 1, opacity: 0.8 }}>
                                                        <Icon name="check" size={12} />
                                                    </span>
                                                    {f}
                                                </li>
                                            ))}
                                        </ul>
                                    </button>
                                )
                            })}
                        </div>
                        {onShowPacks && (
                            <p
                                style={{
                                    font: '400 12px/1.5 var(--font-body)',
                                    color: 'var(--color-on-surface-variant)',
                                    margin: 0,
                                }}>
                                Just need a few minutes once?{' '}
                                <button
                                    type="button"
                                    onClick={onShowPacks}
                                    style={{
                                        border: 0,
                                        background: 'transparent',
                                        padding: 0,
                                        cursor: 'pointer',
                                        font: '500 12px/1.5 var(--font-body)',
                                        color: 'var(--color-primary)',
                                        textDecoration: 'underline',
                                    }}>
                                    One-time minute packs
                                </button>
                            </p>
                        )}
                        {isCancel && (
                            <div
                                style={{
                                    background: 'var(--color-error-container)',
                                    color: 'var(--color-on-error-container)',
                                    borderRadius: 8,
                                    padding: '12px 14px',
                                    font: '400 13px/1.5 var(--font-body)',
                                }}>
                                You'll keep <strong>{currentPlan.name}</strong> features until the end of your billing period, then drop to
                                Sketch. Your scores are never deleted.
                            </div>
                        )}
                        {isDowngrade && !isCancel && (
                            <div
                                style={{
                                    background: 'var(--color-surface-container-low)',
                                    borderRadius: 8,
                                    padding: '12px 14px',
                                    font: '400 13px/1.5 var(--font-body)',
                                    color: 'var(--color-on-surface-variant)',
                                }}>
                                The switch takes effect right away; Polar prorates the difference on your next invoice.
                            </div>
                        )}
                    </div>
                )}
                {phase === 'redirecting' && (
                    <div
                        style={{
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            gap: 14,
                            padding: '24px 16px',
                        }}>
                        <div
                            style={{
                                width: 40,
                                height: 40,
                                borderRadius: 9999,
                                border: '3px solid var(--color-surface-container)',
                                borderTopColor: 'var(--color-primary)',
                                animation: 'sheemu-spin 700ms linear infinite',
                            }}
                        />
                        <style>{`@keyframes sheemu-spin { to { transform: rotate(360deg); } }`}</style>
                        <span
                            style={{
                                font: '400 13px/1.5 var(--font-body)',
                                color: 'var(--color-on-surface-variant)',
                                textAlign: 'center',
                                maxWidth: 360,
                            }}>
                            {isDowngrade || isCancel
                                ? 'Talking to Polar to update your subscription.'
                                : "Sending you to Polar's secure checkout…"}
                        </span>
                    </div>
                )}
                {phase === 'done' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '8px 0 16px' }}>
                        <span
                            style={{
                                width: 40,
                                height: 40,
                                borderRadius: 9999,
                                flexShrink: 0,
                                background: 'var(--color-primary-container)',
                                color: 'var(--color-on-primary-container)',
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                            }}>
                            <Icon name="check" size={20} />
                        </span>
                        <span style={{ font: '400 14px/1.5 var(--font-body)', color: 'var(--color-on-surface-variant)' }}>
                            {isCancel
                                ? 'Your subscription ends at the close of the current billing period. You can resume any time before then.'
                                : 'Polar has the new plan on file. Receipt follows by email.'}
                        </span>
                    </div>
                )}
                {phase === 'error' && (
                    <div
                        style={{
                            background: 'var(--color-error-container)',
                            color: 'var(--color-on-error-container)',
                            borderRadius: 8,
                            padding: '12px 14px',
                            font: '400 13px/1.5 var(--font-body)',
                            marginBottom: 12,
                        }}>
                        {errorMsg || "Polar didn't respond. Try again in a moment."}
                    </div>
                )}
            </DialogPanel>
        </DialogScrim>
    )
}

// One-time minute packs — deliberately the secondary offer: the dialog opens
// with an honest "a subscription is the better deal" nudge and every card
// carries its subscription comparison. Checkout is Polar-hosted; the minutes
// land via the `order.paid` webhook and never expire.
function PacksDialog({ onCancel, onSeePlans }) {
    const [selected, setSelected] = useState('single')
    const [phase, setPhase] = useState('choose') // 'choose' | 'redirecting'
    const pack = SETTINGS_CREDIT_PACKS.find((p) => p.id === selected) ?? SETTINGS_CREDIT_PACKS[0]
    const locked = phase !== 'choose'

    const buy = () => {
        if (locked) return
        setPhase('redirecting')
        // Mock — production redirects to Polar's hosted checkout and returns
        // to /settings?pack=success once the payment completes.
        setTimeout(onCancel, 1600)
    }

    return (
        <DialogScrim onDismiss={locked ? undefined : onCancel}>
            <DialogPanel
                title={phase === 'redirecting' ? 'Redirecting to Polar…' : 'One-time minute packs'}
                subtitle={
                    phase === 'choose'
                        ? 'Extra recording minutes without a subscription. They never expire and are used once your daily minutes run out.'
                        : null
                }
                onClose={locked ? undefined : onCancel}
                width={640}
                footer={
                    phase === 'choose' ? (
                        <>
                            {onSeePlans && <TertiaryButton onClick={onSeePlans}>See subscription plans</TertiaryButton>}
                            <PrimaryButton icon="external-link" onClick={buy}>
                                {`Buy ${pack.name} · $${pack.price}`}
                            </PrimaryButton>
                        </>
                    ) : null
                }>
                {phase === 'choose' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: 8 }}>
                        <div
                            style={{
                                background: 'var(--color-surface-container-low)',
                                color: 'var(--color-on-surface-variant)',
                                borderRadius: 8,
                                padding: '12px 14px',
                                font: '400 13px/1.5 var(--font-body)',
                            }}>
                            Recording regularly? <strong>Songwriter</strong> gives you 20 minutes <em>every day</em> for $9/month — packs
                            are for the once-in-a-while.
                        </div>
                        <div role="radiogroup" aria-label="Minute pack" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                            {SETTINGS_CREDIT_PACKS.map((p) => {
                                const active = selected === p.id
                                return (
                                    <button
                                        key={p.id}
                                        type="button"
                                        role="radio"
                                        aria-checked={active}
                                        onClick={() => setSelected(p.id)}
                                        style={{
                                            textAlign: 'left',
                                            background: active ? 'var(--color-primary-soft)' : 'var(--color-surface-container-lowest)',
                                            color: active ? 'var(--color-on-primary-soft)' : 'var(--color-on-surface)',
                                            border: 0,
                                            borderRadius: 12,
                                            padding: 16,
                                            cursor: 'pointer',
                                            display: 'flex',
                                            flexDirection: 'column',
                                            gap: 8,
                                            boxShadow: active ? 'none' : 'var(--shadow-tonal)',
                                        }}>
                                        <span style={{ font: '600 14px/1.2 var(--font-body)' }}>{p.name}</span>
                                        <span
                                            style={{
                                                fontFamily: 'var(--font-mono)',
                                                fontWeight: 600,
                                                fontSize: 22,
                                                lineHeight: 1,
                                                letterSpacing: '-0.01em',
                                            }}>
                                            ${p.price}
                                        </span>
                                        <span style={{ font: '400 13px/1.4 var(--font-body)' }}>{p.minutes} min of recording</span>
                                        <span style={{ font: '400 12px/1.4 var(--font-body)', opacity: 0.8 }}>{p.blurb}</span>
                                    </button>
                                )
                            })}
                        </div>
                        <p style={{ font: '400 12px/1.5 var(--font-body)', color: 'var(--color-on-surface-variant)', margin: 0 }}>
                            {pack.compare}
                        </p>
                    </div>
                )}
                {phase === 'redirecting' && (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, padding: '24px 16px' }}>
                        <div
                            style={{
                                width: 40,
                                height: 40,
                                borderRadius: 9999,
                                border: '3px solid var(--color-surface-container)',
                                borderTopColor: 'var(--color-primary)',
                                animation: 'sheemu-spin 700ms linear infinite',
                            }}
                        />
                        <style>{`@keyframes sheemu-spin { to { transform: rotate(360deg); } }`}</style>
                        <span
                            style={{
                                font: '400 13px/1.5 var(--font-body)',
                                color: 'var(--color-on-surface-variant)',
                                textAlign: 'center',
                                maxWidth: 360,
                            }}>
                            Sending you to Polar's secure checkout…
                        </span>
                    </div>
                )}
            </DialogPanel>
        </DialogScrim>
    )
}

function SettingsSection({ title, subtitle, children }) {
    return (
        <section
            style={{
                background: 'var(--color-surface-container-lowest)',
                borderRadius: 12,
                boxShadow: '0 0 24px 0 rgba(45,47,47,0.06)',
                padding: 28,
                display: 'flex',
                flexDirection: 'column',
                gap: 20,
            }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <h3 style={{ font: '600 18px/1.2 var(--font-headline)', color: 'var(--color-on-surface)', margin: 0 }}>{title}</h3>
                {subtitle && (
                    <span style={{ font: '400 13px/1.5 var(--font-body)', color: 'var(--color-on-surface-variant)' }}>{subtitle}</span>
                )}
            </div>
            {children}
        </section>
    )
}

function Switch({ checked, onChange, label }) {
    return (
        <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, cursor: 'pointer' }}>
            <span style={{ font: '400 14px/1.4 var(--font-body)', color: 'var(--color-on-surface)' }}>{label}</span>
            <button
                type="button"
                role="switch"
                aria-checked={checked}
                onClick={() => onChange(!checked)}
                style={{
                    width: 40,
                    height: 22,
                    borderRadius: 9999,
                    border: 0,
                    padding: 2,
                    cursor: 'pointer',
                    background: checked ? 'var(--color-primary-container)' : 'var(--color-surface-container-high)',
                    position: 'relative',
                    transition: 'background 150ms var(--ease)',
                }}>
                <span
                    style={{
                        display: 'block',
                        width: 18,
                        height: 18,
                        borderRadius: 9999,
                        background: '#fff',
                        boxShadow: '0 1px 2px rgba(45,47,47,0.18)',
                        transform: checked ? 'translateX(18px)' : 'translateX(0)',
                        transition: 'transform 220ms var(--ease)',
                    }}
                />
            </button>
        </label>
    )
}

// Change-password dialog — opened from Settings → Account.
function ChangePasswordDialog({ onCancel, onSuccess }) {
    const [current, setCurrent] = useState('')
    const [next, setNext] = useState('')
    const [confirm, setConfirm] = useState('')
    const [showPw, setShowPw] = useState(false)
    const [error, setError] = useState('')
    const [saved, setSaved] = useState(false)

    const pwScore = scorePassword(next)
    const pwMatch = next.length > 0 && next === confirm
    const canSubmit = current.length > 0 && pwScore >= 2 && pwMatch && next !== current

    const submit = () => {
        if (!canSubmit) return
        // Mock: any non-empty current accepted.
        setError('')
        setSaved(true)
        setTimeout(() => onSuccess?.(), 900)
    }

    const eye = (
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
    )

    return (
        <DialogScrim onDismiss={onCancel}>
            <DialogPanel
                title={saved ? 'Password updated.' : 'Change password'}
                subtitle={
                    saved ? 'Use your new password next time you sign in.' : 'At least 8 characters, with a mix of letters and numbers.'
                }
                onClose={onCancel}
                width={480}
                footer={
                    saved ? (
                        <PrimaryButton emphasis="pop" onClick={onSuccess}>
                            Done
                        </PrimaryButton>
                    ) : (
                        <>
                            <TertiaryButton onClick={onCancel}>Cancel</TertiaryButton>
                            <PrimaryButton emphasis="pop" disabled={!canSubmit} onClick={submit}>
                                Update password
                            </PrimaryButton>
                        </>
                    )
                }>
                {saved ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 14, paddingBottom: 16 }}>
                        <span
                            style={{
                                width: 40,
                                height: 40,
                                borderRadius: 9999,
                                background: 'var(--color-primary-container)',
                                color: 'var(--color-on-primary-container)',
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                flexShrink: 0,
                            }}>
                            <Icon name="check" size={20} />
                        </span>
                        <span style={{ font: '400 14px/1.5 var(--font-body)', color: 'var(--color-on-surface-variant)' }}>
                            We've signed you out everywhere else as a precaution.
                        </span>
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: 16 }}>
                        <TextField
                            label="Current password"
                            value={current}
                            onChange={setCurrent}
                            type={showPw ? 'text' : 'password'}
                            placeholder="••••••••••••"
                            autoFocus
                        />
                        <TextField
                            label="New password"
                            value={next}
                            onChange={setNext}
                            type={showPw ? 'text' : 'password'}
                            placeholder="••••••••••••"
                            rightSlot={eye}
                        />
                        {/* Strength meter — same pattern as PasswordResetCard set-new */}
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
                            label="Confirm new password"
                            value={confirm}
                            onChange={setConfirm}
                            type={showPw ? 'text' : 'password'}
                            placeholder="••••••••••••"
                        />
                        {confirm.length > 0 && !pwMatch && (
                            <span style={{ font: '500 12px/1.4 var(--font-body)', color: 'var(--color-error)', marginTop: -8 }}>
                                Passwords don't match yet.
                            </span>
                        )}
                        {next.length > 0 && next === current && (
                            <span style={{ font: '500 12px/1.4 var(--font-body)', color: 'var(--color-error)', marginTop: -8 }}>
                                Pick something different from your current password.
                            </span>
                        )}
                        {error && <span style={{ font: '500 12px/1.4 var(--font-body)', color: 'var(--color-error)' }}>{error}</span>}
                        <span style={{ font: '400 12px/1.5 var(--font-body)', color: 'var(--color-on-surface-variant)' }}>
                            Forgot your current password?{' '}
                            <a
                                href="#"
                                onClick={(e) => {
                                    e.preventDefault()
                                    onCancel()
                                }}
                                style={{ color: 'var(--color-primary)' }}>
                                Send a reset link by email
                            </a>{' '}
                            instead.
                        </span>
                    </div>
                )}
            </DialogPanel>
        </DialogScrim>
    )
}

// Delete-account dialog — deactivates today, purges after a 7-day grace
// period. Signing back in before the purge date undoes it (production shows a
// ReactivateAccountDialog on the next login).
function DeleteAccountDialog({ user, onCancel, onConfirm }) {
    const email = user?.email ?? 'anya@example.com'
    const [stage, setStage] = useState('confirm') // 'confirm' | 'done'
    const [typed, setTyped] = useState('')
    const [pw, setPw] = useState('')
    const [ack, setAck] = useState(false)
    const phrase = 'delete my account'
    const phraseMatch = typed.trim().toLowerCase() === phrase
    const canSubmit = phraseMatch && pw.length > 0 && ack
    // Mock — production derives this from the API's purgeAfter timestamp.
    const purgeDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toLocaleDateString(undefined, { month: 'long', day: 'numeric' })

    const submit = () => {
        if (!canSubmit) return
        setStage('done')
        // Give the goodbye note a beat to land before signing out.
        setTimeout(() => onConfirm?.(), 3000)
    }

    return (
        <DialogScrim onDismiss={stage === 'done' ? undefined : onCancel}>
            <DialogPanel
                title={stage === 'done' ? 'Account scheduled for deletion.' : 'Delete your account?'}
                subtitle={
                    stage === 'done'
                        ? 'Signing you out…'
                        : 'Your account is deactivated today and permanently deleted after 7 days. Signing back in before then undoes it.'
                }
                onClose={stage === 'done' ? undefined : onCancel}
                width={520}
                footer={
                    stage === 'done' ? null : (
                        <>
                            <TertiaryButton onClick={onCancel}>Keep my account</TertiaryButton>
                            <PrimaryButton danger disabled={!canSubmit} onClick={submit}>
                                Delete account
                            </PrimaryButton>
                        </>
                    )
                }>
                {stage === 'done' ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 14, paddingBottom: 16 }}>
                        <span
                            style={{
                                width: 40,
                                height: 40,
                                borderRadius: 9999,
                                background: 'var(--color-surface-container)',
                                color: 'var(--color-on-surface-variant)',
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                flexShrink: 0,
                            }}>
                            <Icon name="check" size={20} />
                        </span>
                        <span style={{ font: '400 14px/1.5 var(--font-body)', color: 'var(--color-on-surface-variant)' }}>
                            Thanks for being here. Changed your mind? Sign back in with{' '}
                            <strong style={{ color: 'var(--color-on-surface)' }}>{email}</strong> before{' '}
                            <strong style={{ color: 'var(--color-on-surface)' }}>{purgeDate}</strong> and everything will be right where
                            you left it.
                        </span>
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: 16 }}>
                        {/* Loss summary — small inventory of what disappears */}
                        <div
                            style={{
                                background: 'var(--color-surface-container-low)',
                                borderRadius: 8,
                                padding: 16,
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 10,
                            }}>
                            <Eyebrow>After 7 days you'll lose</Eyebrow>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                {[
                                    ['music', 'All your scores and recordings'],
                                    ['download', 'All MIDI and PDF exports'],
                                    ['link', 'Share links — they stop working once deletion completes'],
                                ].map(([icon, text]) => (
                                    <div key={text} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                        <Icon name={icon} size={16} />
                                        <span style={{ font: '400 13px/1.4 var(--font-body)', color: 'var(--color-on-surface)' }}>
                                            {text}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <TextField
                            label={
                                <>
                                    Type{' '}
                                    <span style={{ font: '500 13px/1 var(--font-mono)', color: 'var(--color-on-surface)' }}>{phrase}</span>{' '}
                                    to confirm
                                </>
                            }
                            value={typed}
                            onChange={setTyped}
                            placeholder={phrase}
                            autoFocus
                        />
                        <TextField label="Your password" value={pw} onChange={setPw} type="password" placeholder="••••••••••••" />

                        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
                            <input
                                type="checkbox"
                                checked={ack}
                                onChange={(e) => setAck(e.target.checked)}
                                style={{ marginTop: 3, accentColor: 'var(--color-error)' }}
                            />
                            <span style={{ font: '400 13px/1.5 var(--font-body)', color: 'var(--color-on-surface-variant)' }}>
                                I understand that after the 7-day grace period this can't be undone, and that exporting my scores first is
                                recommended.
                            </span>
                        </label>
                    </div>
                )}
            </DialogPanel>
        </DialogScrim>
    )
}

function Settings({ user, onSave, onSignOut, recUsedSec = 0, onResetUsage, planId: planIdProp, onPlanChange }) {
    const [tab, setTab] = useState('profile')
    const [name, setName] = useState(user?.name ?? 'Anya Mokri')
    const email = user?.email ?? 'anya@example.com' // read-only — changed via support only
    const [changePwOpen, setChangePwOpen] = useState(false)
    const [deleteOpen, setDeleteOpen] = useState(false)
    const [planOpen, setPlanOpen] = useState(false)
    const [packsOpen, setPacksOpen] = useState(false)
    // In production the subscription state (plan, cadence, credits, banked
    // pack minutes) comes from the billing API. When App owns the plan (so the
    // editor's quota stays in sync), it passes `planId` + `onPlanChange`.
    const [planIdLocal, setPlanIdLocal] = useState(user?.planId ?? 'pro')
    const planId = planIdProp ?? planIdLocal
    const setPlanId = onPlanChange ?? setPlanIdLocal
    const [billing, setBilling] = useState(user?.billing ?? 'monthly')
    const [planChangedToast, setPlanChangedToast] = useState('')
    const currentPlan = SETTINGS_PLAN_TIERS.find((p) => p.id === planId)
    const packSeconds = user?.packSeconds ?? 900 // demo default: 15:00 banked from packs

    return (
        <main
            data-screen-label="Settings"
            style={{
                flex: 1,
                maxWidth: 1024,
                margin: '0 auto',
                padding: '40px 32px',
                display: 'flex',
                flexDirection: 'column',
                gap: 32,
                width: '100%',
                boxSizing: 'border-box',
            }}>
            <PageHeader title="Settings" subtitle="Tweak your profile and account." />

            <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 32, alignItems: 'flex-start' }}>
                {/* Side nav — becomes a horizontal tab row below the md breakpoint in production */}
                <nav style={{ display: 'flex', flexDirection: 'column', gap: 4, position: 'sticky', top: 96 }}>
                    {[
                        ['profile', 'Profile', 'user'],
                        ['account', 'Account', 'shield'],
                    ].map(([k, label, icon]) => (
                        <button
                            key={k}
                            onClick={() => setTab(k)}
                            style={{
                                background: tab === k ? 'var(--color-surface-container)' : 'transparent',
                                color: tab === k ? 'var(--color-on-surface)' : 'var(--color-on-surface-variant)',
                                border: 0,
                                borderRadius: 8,
                                padding: '10px 14px',
                                textAlign: 'left',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 10,
                                font: '500 14px/1 var(--font-body)',
                            }}>
                            <Icon name={icon} size={16} />
                            {label}
                        </button>
                    ))}
                </nav>

                {/* Panel */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    {tab === 'profile' && (
                        <SettingsSection title="Profile" subtitle="How you appear across Sheemu.">
                            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                                <div
                                    style={{
                                        width: 64,
                                        height: 64,
                                        borderRadius: 9999,
                                        background: 'var(--color-secondary-soft)',
                                        color: 'var(--color-on-secondary-soft)',
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        font: '600 22px/1 var(--font-label)',
                                    }}>
                                    {name
                                        .split(' ')
                                        .map((s) => s[0])
                                        .join('')
                                        .slice(0, 2)
                                        .toUpperCase()}
                                </div>
                            </div>
                            <TextField label="Display name" value={name} onChange={setName} />
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                <Eyebrow>Email</Eyebrow>
                                <span style={{ font: '400 14px/1 var(--font-body)', color: 'var(--color-on-surface)', padding: '4px 0' }}>
                                    {email}
                                </span>
                                <span style={{ font: '400 12px/1.4 var(--font-body)', color: 'var(--color-on-surface-variant)' }}>
                                    Your sign-in email. Contact support to change it.
                                </span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                                <PrimaryButton onClick={onSave} disabled={!name.trim()}>
                                    Save changes
                                </PrimaryButton>
                            </div>
                        </SettingsSection>
                    )}

                    {tab === 'account' && (
                        <>
                            <SettingsSection
                                title="Plan & billing"
                                subtitle={
                                    currentPlan.id === 'free'
                                        ? "You're on the free Sketch plan."
                                        : `You're on the ${currentPlan.name} plan. Payments are handled securely by Polar.`
                                }>
                                <div
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 16,
                                        padding: 16,
                                        background: 'var(--color-surface-container-low)',
                                        borderRadius: 10,
                                    }}>
                                    <span
                                        style={{
                                            width: 44,
                                            height: 44,
                                            borderRadius: 9999,
                                            flexShrink: 0,
                                            background: 'var(--color-primary-container)',
                                            color: 'var(--color-on-primary-container)',
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                        }}>
                                        <Icon name={currentPlan.icon} size={20} />
                                    </span>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
                                        <span style={{ font: '600 15px/1.3 var(--font-body)', color: 'var(--color-on-surface)' }}>
                                            {currentPlan.name}
                                        </span>
                                        <span style={{ font: '400 13px/1.4 var(--font-body)', color: 'var(--color-on-surface-variant)' }}>
                                            {settingsPlanPrice(currentPlan, billing)}
                                            {currentPlan.id !== 'free' && ' · renews August 16, 2026'}
                                        </span>
                                    </div>
                                    <PrimaryButton onClick={() => setPlanOpen(true)}>Change plan</PrimaryButton>
                                </div>

                                {/* Today's recording budget (resets at midnight UTC), plus any
                                    purchased pack minutes waiting behind it. Every sold tier has a
                                    cap — there is no "unlimited" branch. */}
                                {(() => {
                                    const limit = currentPlan.dailyLimitSec
                                    const exhausted = recUsedSec >= limit
                                    const pct = Math.min(1, recUsedSec / limit)
                                    const fmt = (s) => {
                                        const v = Math.max(0, Math.floor(s))
                                        return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`
                                    }
                                    return (
                                        <div
                                            style={{
                                                display: 'flex',
                                                flexDirection: 'column',
                                                gap: 10,
                                                padding: '14px 16px',
                                                background: 'var(--color-surface-container-low)',
                                                borderRadius: 10,
                                            }}>
                                            <div
                                                style={{
                                                    display: 'flex',
                                                    justifyContent: 'space-between',
                                                    alignItems: 'baseline',
                                                    gap: 12,
                                                }}>
                                                <span
                                                    style={{
                                                        font: '400 12px/1 var(--font-body)',
                                                        color: 'var(--color-on-surface-variant)',
                                                    }}>
                                                    Recording today
                                                </span>
                                                <span
                                                    style={{
                                                        font: '500 12px/1 var(--font-mono)',
                                                        color: exhausted ? 'var(--color-error)' : 'var(--color-on-surface-variant)',
                                                    }}>
                                                    {fmt(recUsedSec)} / {fmt(limit)}
                                                </span>
                                            </div>
                                            <div
                                                role="progressbar"
                                                aria-valuenow={Math.round(pct * 100)}
                                                style={{
                                                    height: 6,
                                                    borderRadius: 6,
                                                    background: 'var(--color-surface-container)',
                                                    overflow: 'hidden',
                                                }}>
                                                <div
                                                    style={{
                                                        width: `${pct * 100}%`,
                                                        height: '100%',
                                                        background: exhausted
                                                            ? 'var(--color-error-container)'
                                                            : 'var(--color-primary-container)',
                                                        transition: 'width 200ms linear, background 200ms var(--ease)',
                                                    }}
                                                />
                                            </div>
                                            {packSeconds > 0 && (
                                                <div
                                                    style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: 8,
                                                        font: '400 12px/1.4 var(--font-body)',
                                                        color: 'var(--color-on-surface-variant)',
                                                    }}>
                                                    <Icon name="gift" size={14} />
                                                    <span>
                                                        <span style={{ fontFamily: 'var(--font-mono)' }}>{fmt(packSeconds)}</span> banked
                                                        from packs — used once today's minutes run out, never expires.
                                                    </span>
                                                </div>
                                            )}
                                        </div>
                                    )
                                })()}

                                <div>
                                    <TertiaryButton onClick={() => setPacksOpen(true)}>Top up with a one-time pack</TertiaryButton>
                                </div>
                                {planChangedToast && (
                                    <div
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: 10,
                                            background: 'var(--color-primary-soft)',
                                            color: 'var(--color-on-primary-soft)',
                                            borderRadius: 8,
                                            padding: '10px 14px',
                                            font: '500 13px/1.4 var(--font-body)',
                                        }}>
                                        <Icon name="check" size={16} />
                                        {planChangedToast}
                                    </div>
                                )}
                                {currentPlan.id !== 'free' && (
                                    <div>
                                        {/* Opens Polar's hosted customer portal in production. */}
                                        <TertiaryButton>Invoices &amp; payment method</TertiaryButton>
                                    </div>
                                )}
                            </SettingsSection>
                            <SettingsSection title="Password" subtitle="Update the password you use to sign in.">
                                <div>
                                    <SecondaryButton onClick={() => setChangePwOpen(true)}>Change password</SecondaryButton>
                                </div>
                            </SettingsSection>
                            <SettingsSection title="Support" subtitle="Stuck, found a bug, or want to say hi? We read everything.">
                                <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                                    <a
                                        href="mailto:support@sheemu.com"
                                        style={{
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: 8,
                                            color: 'var(--color-primary)',
                                            font: '500 14px/1 var(--font-body)',
                                            textDecoration: 'none',
                                        }}>
                                        <Icon name="mail" size={16} /> support@sheemu.com
                                    </a>
                                    <a
                                        href="#"
                                        onClick={(e) => e.preventDefault()}
                                        style={{
                                            color: 'var(--color-on-surface-variant)',
                                            font: '400 13px/1 var(--font-body)',
                                            textDecoration: 'underline',
                                        }}>
                                        All contact options
                                    </a>
                                </div>
                            </SettingsSection>
                            <SettingsSection title="Sign out" subtitle="Log out of this browser.">
                                <div>
                                    <TertiaryButton onClick={onSignOut}>Sign out</TertiaryButton>
                                </div>
                            </SettingsSection>
                            <SettingsSection
                                title="Delete account"
                                subtitle="Deactivates your account today; after 7 days everything is permanently deleted.">
                                <div>
                                    <TertiaryButton danger onClick={() => setDeleteOpen(true)}>
                                        Delete my account
                                    </TertiaryButton>
                                </div>
                            </SettingsSection>
                        </>
                    )}
                </div>
            </div>
            {changePwOpen && <ChangePasswordDialog onCancel={() => setChangePwOpen(false)} onSuccess={() => setChangePwOpen(false)} />}
            {deleteOpen && (
                <DeleteAccountDialog
                    user={{ name, email }}
                    onCancel={() => setDeleteOpen(false)}
                    onConfirm={() => {
                        setDeleteOpen(false)
                        onSignOut?.()
                    }}
                />
            )}
            {packsOpen && (
                <PacksDialog
                    onCancel={() => setPacksOpen(false)}
                    onSeePlans={() => {
                        setPacksOpen(false)
                        setPlanOpen(true)
                    }}
                />
            )}
            {planOpen && (
                <ChangePlanDialog
                    currentPlanId={planId}
                    currentBilling={billing}
                    onShowPacks={() => {
                        setPlanOpen(false)
                        setPacksOpen(true)
                    }}
                    onCancel={() => setPlanOpen(false)}
                    onChanged={({ planId: nextId, billing: nextBilling }) => {
                        const nextPlan = SETTINGS_PLAN_TIERS.find((p) => p.id === nextId)
                        setPlanId(nextId)
                        setBilling(nextBilling)
                        setPlanOpen(false)
                        setPlanChangedToast(
                            nextId === 'free' && planId !== 'free'
                                ? "Subscription cancelled. You'll keep paid features until the end of the cycle."
                                : `Switched to ${nextPlan.name} (${nextBilling}).`,
                        )
                        setTimeout(() => setPlanChangedToast(''), 6000)
                    }}
                />
            )}
        </main>
    )
}

Object.assign(window, { Settings })
