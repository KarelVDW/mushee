// User settings — profile, preferences, account.

// Mirrors the catalogue in Onboarding. In production both would import a shared
// constants module fed by /api/polar/products.
const SETTINGS_PLAN_TIERS = [
  { id: 'free',   name: 'Sketch',   icon: 'feather',   tagline: 'For trying it out.',
    priceMonthly: 0,  priceYearly: 0,   polarProductId: null, dailyLimitSec: 30,
    features: ['30 sec recording / day', '3 scores', 'Transcription', 'PDF export'] },
  { id: 'pro',    name: 'Composer', icon: 'sparkles',  tagline: 'For regular writing.',
    priceMonthly: 8,  priceYearly: 80,  polarProductId: 'prod_composer_v1', dailyLimitSec: 600,
    features: ['10 min recording / day', 'Unlimited scores', 'MIDI + MusicXML', 'Shareable links', 'Editor themes'] },
  { id: 'studio', name: 'Studio',   icon: 'gem',       tagline: 'For teaching & teams.',
    priceMonthly: 18, priceYearly: 180, polarProductId: 'prod_studio_v1', dailyLimitSec: Infinity,
    features: ['Unlimited recording', 'Everything in Composer', '5 collaborators per score', 'Custom templates', 'Priority support'] },
];

function settingsPlanPrice(plan, billing) {
  if (plan.priceMonthly === 0) return 'Free';
  if (billing === 'yearly') {
    const m = (plan.priceYearly / 12).toFixed(plan.priceYearly % 12 === 0 ? 0 : 2);
    return `$${m}/mo · billed yearly`;
  }
  return `$${plan.priceMonthly}/mo`;
}

// Change-plan dialog — lets the user pick a new tier and hands off to Polar
// (or to Polar's customer portal for downgrades / cancellation).
function ChangePlanDialog({ currentPlanId, currentBilling, onCancel, onChanged }) {
  const [selected, setSelected] = useState(currentPlanId);
  const [billing, setBilling] = useState(currentBilling);
  const [phase, setPhase] = useState('choose'); // 'choose' | 'redirecting' | 'done' | 'error'
  const [errorMsg, setErrorMsg] = useState('');

  const currentPlan = SETTINGS_PLAN_TIERS.find((p) => p.id === currentPlanId);
  const nextPlan = SETTINGS_PLAN_TIERS.find((p) => p.id === selected);
  const isSame = selected === currentPlanId && billing === currentBilling;
  const isDowngrade = nextPlan.priceMonthly < currentPlan.priceMonthly;
  const isCancel = nextPlan.id === 'free' && currentPlan.id !== 'free';

  const apply = async () => {
    if (isSame) return;
    // Free plan / downgrade: handled via Polar's subscription update API — no checkout redirect.
    // Production:
    //   await fetch('/api/polar/subscription', { method: 'PATCH',
    //     body: JSON.stringify({ productId: nextPlan.polarProductId, billing }) });
    if (isDowngrade || isCancel) {
      setPhase('redirecting');
      try {
        await new Promise((r) => setTimeout(r, 900));
        setPhase('done');
        setTimeout(() => onChanged({ planId: selected, billing }), 900);
      } catch (e) {
        setErrorMsg(e.message || 'Couldn\'t reach Polar.');
        setPhase('error');
      }
      return;
    }
    // Upgrade: hand off to Polar's hosted checkout.
    // Production:
    //   const session = await fetch('/api/polar/checkout', { method: 'POST',
    //     body: JSON.stringify({ productId: nextPlan.polarProductId, billing,
    //       successUrl: `${origin}/settings?plan=changed`,
    //       cancelUrl:  `${origin}/settings?plan=cancelled` }) }).then(r => r.json());
    //   window.location.href = session.url;
    setPhase('redirecting');
    try {
      await new Promise((r) => setTimeout(r, 1400));
      setPhase('done');
      setTimeout(() => onChanged({ planId: selected, billing }), 900);
    } catch (e) {
      setErrorMsg(e.message || 'Couldn\'t reach Polar.');
      setPhase('error');
    }
  };

  const ctaLabel = isSame ? 'No change'
    : isCancel ? 'Cancel subscription'
    : isDowngrade ? `Switch to ${nextPlan.name}`
    : 'Continue to Polar checkout';

  return (
    <DialogScrim onDismiss={phase === 'redirecting' || phase === 'done' ? undefined : onCancel}>
      <DialogPanel
        title={phase === 'done' ? 'Plan updated.'
          : phase === 'redirecting' ? (isDowngrade || isCancel ? 'Updating your subscription…' : 'Redirecting to Polar…')
          : 'Change plan'}
        eyebrow={phase === 'done' ? `You're now on ${nextPlan.name}.`
          : phase === 'redirecting' ? null
          : 'Switch tiers, change billing cadence, or cancel. Payments are processed by Polar.'}
        onClose={phase === 'redirecting' || phase === 'done' ? undefined : onCancel}
        width={720}
        footer={phase === 'choose' || phase === 'error' ? (
          <>
            <TertiaryButton onClick={onCancel}>Keep current plan</TertiaryButton>
            <PrimaryButton emphasis="pop" disabled={isSame} danger={isCancel}
              icon={!isDowngrade && !isCancel ? 'external-link' : undefined}
              onClick={apply}>{ctaLabel}</PrimaryButton>
          </>
        ) : null}>
        {phase === 'choose' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18, paddingBottom: 8 }}>
            <div role="radiogroup" aria-label="Billing cadence" style={{
              display: 'inline-flex', padding: 3, borderRadius: 9999,
              background: 'var(--color-surface-container-low)', alignSelf: 'flex-start',
            }}>
              {[['monthly','Monthly'], ['yearly','Yearly · save 17%']].map(([k, label]) => {
                const active = billing === k;
                return (
                  <button key={k} type="button" role="radio" aria-checked={active}
                    onClick={() => setBilling(k)} style={{
                      background: active ? 'var(--color-surface-container-lowest)' : 'transparent',
                      color: active ? 'var(--color-on-surface)' : 'var(--color-on-surface-variant)',
                      boxShadow: active ? '0 1px 3px rgba(45,47,47,0.08)' : 'none',
                      border: 0, padding: '7px 14px', borderRadius: 9999, cursor: 'pointer',
                      font: '600 12px/1 var(--font-label)',
                    }}>{label}</button>
                );
              })}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
              {SETTINGS_PLAN_TIERS.map((p) => {
                const active = selected === p.id;
                const isCurrent = p.id === currentPlanId && billing === currentBilling;
                return (
                  <button key={p.id} onClick={() => setSelected(p.id)} aria-pressed={active} style={{
                    position: 'relative', textAlign: 'left',
                    background: active ? 'var(--color-primary-soft)' : 'var(--color-surface-container-lowest)',
                    color: active ? 'var(--color-on-primary-soft)' : 'var(--color-on-surface)',
                    border: 0, borderRadius: 12, padding: '16px 16px 14px',
                    cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 10,
                    boxShadow: active ? 'none' : 'inset 0 0 0 1px var(--color-outline-variant)',
                  }}>
                    {isCurrent && (
                      <span style={{
                        position: 'absolute', top: -10, right: 14,
                        background: 'var(--color-surface-container-high)', color: 'var(--color-on-surface)',
                        font: '600 10px/1 var(--font-label)', letterSpacing: '0.12em', textTransform: 'uppercase',
                        padding: '6px 10px', borderRadius: 9999,
                      }}>Current</span>
                    )}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <Icon name={p.icon} size={18} />
                      <span style={{ font: '600 14px/1.2 var(--font-body)' }}>{p.name}</span>
                    </div>
                    <span style={{
                      fontFamily: 'var(--font-display)', fontStyle: 'italic', fontWeight: 400,
                      fontSize: 24, lineHeight: 1, letterSpacing: '-0.02em',
                    }}>{settingsPlanPrice(p, billing)}</span>
                    <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {p.features.map((f) => (
                        <li key={f} style={{ display: 'flex', alignItems: 'flex-start', gap: 6,
                          font: '400 12px/1.4 var(--font-body)' }}>
                          <span style={{ marginTop: 1, opacity: 0.8 }}><Icon name="check" size={12} /></span>
                          {f}
                        </li>
                      ))}
                    </ul>
                  </button>
                );
              })}
            </div>
            {isCancel && (
              <div style={{
                background: 'var(--color-error-container)', color: 'var(--color-on-error-container)',
                borderRadius: 8, padding: '12px 14px', font: '400 13px/1.5 var(--font-body)',
              }}>
                You'll keep <strong>{currentPlan.name}</strong> features until your next billing date,
                then drop to Sketch. Scores beyond the 3-score limit become read-only — they're never deleted.
              </div>
            )}
            {isDowngrade && !isCancel && (
              <div style={{
                background: 'var(--color-surface-container-low)',
                borderRadius: 8, padding: '12px 14px', font: '400 13px/1.5 var(--font-body)',
                color: 'var(--color-on-surface-variant)',
              }}>
                Downgrade takes effect at the end of your current billing cycle. Polar will prorate any difference.
              </div>
            )}
          </div>
        )}
        {phase === 'redirecting' && (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, padding: '24px 16px',
          }}>
            <div style={{
              width: 40, height: 40, borderRadius: 9999,
              border: '3px solid var(--color-surface-container)',
              borderTopColor: 'var(--color-primary)',
              animation: 'sheemu-spin 700ms linear infinite',
            }} />
            <style>{`@keyframes sheemu-spin { to { transform: rotate(360deg); } }`}</style>
            <span style={{ font: '400 13px/1.5 var(--font-body)', color: 'var(--color-on-surface-variant)', textAlign: 'center', maxWidth: 360 }}>
              {isDowngrade || isCancel
                ? 'Talking to Polar to update your subscription.'
                : 'Hand-off to Polar\'s secure checkout in progress…'}
            </span>
          </div>
        )}
        {phase === 'done' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '8px 0 16px' }}>
            <span style={{
              width: 40, height: 40, borderRadius: 9999, flexShrink: 0,
              background: 'var(--color-primary-container)', color: 'var(--color-on-primary-container)',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            }}><Icon name="check" size={20} /></span>
            <span style={{ font: '400 14px/1.5 var(--font-body)', color: 'var(--color-on-surface-variant)' }}>
              {isCancel
                ? 'Subscription cancelled. We sent a confirmation to your email.'
                : 'Polar has the new plan on file. Receipt sent by email.'}
            </span>
          </div>
        )}
        {phase === 'error' && (
          <div style={{
            background: 'var(--color-error-container)', color: 'var(--color-on-error-container)',
            borderRadius: 8, padding: '12px 14px', font: '400 13px/1.5 var(--font-body)', marginBottom: 12,
          }}>{errorMsg || 'Polar didn\'t respond. Try again in a moment.'}</div>
        )}
      </DialogPanel>
    </DialogScrim>
  );
}

function SettingsSection({ title, subtitle, children }) {
  return (
    <section style={{
      background: 'var(--color-surface-container-lowest)', borderRadius: 12,
      boxShadow: '0 0 24px 0 rgba(45,47,47,0.06)',
      padding: 28, display: 'flex', flexDirection: 'column', gap: 20,
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <h3 style={{ font: '600 18px/1.2 var(--font-headline)', color: 'var(--color-on-surface)', margin: 0 }}>{title}</h3>
        {subtitle && <span style={{ font: '400 13px/1.5 var(--font-body)', color: 'var(--color-on-surface-variant)' }}>{subtitle}</span>}
      </div>
      {children}
    </section>
  );
}

function Switch({ checked, onChange, label }) {
  return (
    <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, cursor: 'pointer' }}>
      <span style={{ font: '400 14px/1.4 var(--font-body)', color: 'var(--color-on-surface)' }}>{label}</span>
      <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} style={{
        width: 40, height: 22, borderRadius: 9999, border: 0, padding: 2, cursor: 'pointer',
        background: checked ? 'var(--color-primary-container)' : 'var(--color-surface-container-high)',
        position: 'relative', transition: 'background 150ms var(--ease)',
      }}>
        <span style={{
          display: 'block', width: 18, height: 18, borderRadius: 9999,
          background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
          transform: checked ? 'translateX(18px)' : 'translateX(0)',
          transition: 'transform 220ms var(--ease)',
        }} />
      </button>
    </label>
  );
}

// Change-password dialog — opened from Settings → Account.
function ChangePasswordDialog({ onCancel, onSuccess }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const pwScore = scorePassword(next);
  const pwMatch = next.length > 0 && next === confirm;
  const canSubmit = current.length > 0 && pwScore >= 2 && pwMatch && next !== current;

  const submit = () => {
    if (!canSubmit) return;
    // Mock: any non-empty current accepted.
    setError('');
    setSaved(true);
    setTimeout(() => onSuccess?.(), 900);
  };

  const eye = (
    <button type="button" onClick={() => setShowPw(!showPw)} aria-label="Toggle password visibility" style={{
      background: 'transparent', border: 0, color: 'var(--color-outline)', cursor: 'pointer', padding: 4, display: 'inline-flex',
    }}><Icon name={showPw ? 'eye-off' : 'eye'} size={18} /></button>
  );

  return (
    <DialogScrim onDismiss={onCancel}>
      <DialogPanel
        title={saved ? 'Password updated.' : 'Change password'}
        eyebrow={saved
          ? 'Use your new password next time you sign in.'
          : 'At least 8 characters, with a mix of letters and numbers.'}
        onClose={onCancel} width={480}
        footer={saved ? (
          <PrimaryButton emphasis="pop" onClick={onSuccess}>Done</PrimaryButton>
        ) : (
          <>
            <TertiaryButton onClick={onCancel}>Cancel</TertiaryButton>
            <PrimaryButton emphasis="pop" disabled={!canSubmit} onClick={submit}>
              Update password
            </PrimaryButton>
          </>
        )}>
        {saved ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, paddingBottom: 16 }}>
            <span style={{
              width: 40, height: 40, borderRadius: 9999,
              background: 'var(--color-primary-container)', color: 'var(--color-on-primary-container)',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}><Icon name="check" size={20} /></span>
            <span style={{ font: '400 14px/1.5 var(--font-body)', color: 'var(--color-on-surface-variant)' }}>
              We've signed you out everywhere else as a precaution.
            </span>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: 16 }}>
            <TextField
              label="Current password"
              value={current} onChange={setCurrent}
              type={showPw ? 'text' : 'password'} placeholder="••••••••••••"
              autoFocus
            />
            <TextField
              label="New password"
              value={next} onChange={setNext}
              type={showPw ? 'text' : 'password'} placeholder="••••••••••••"
              rightSlot={eye}
            />
            {/* Strength meter — same pattern as PasswordResetCard set-new */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: -8 }}>
              {[0,1,2,3].map((i) => (
                <div key={i} style={{
                  height: 3, flex: 1, borderRadius: 3,
                  background: i < pwScore
                    ? (pwScore <= 1 ? 'var(--color-error-container)'
                       : pwScore === 2 ? 'var(--color-secondary-soft)'
                       : 'var(--color-primary-container)')
                    : 'var(--color-surface-container)',
                  transition: 'background 180ms var(--ease)',
                }} />
              ))}
              <Eyebrow style={{ marginLeft: 4 }}>{PW_LABELS[pwScore]}</Eyebrow>
            </div>
            <TextField
              label="Confirm new password"
              value={confirm} onChange={setConfirm}
              type={showPw ? 'text' : 'password'} placeholder="••••••••••••"
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
            {error && (
              <span style={{ font: '500 12px/1.4 var(--font-body)', color: 'var(--color-error)' }}>{error}</span>
            )}
            <span style={{ font: '400 12px/1.5 var(--font-body)', color: 'var(--color-on-surface-variant)' }}>
              Forgot your current password?
              {' '}
              <a href="#" onClick={(e) => { e.preventDefault(); onCancel(); }}
                style={{ color: 'var(--color-primary)' }}>Send a reset link by email</a> instead.
            </span>
          </div>
        )}
      </DialogPanel>
    </DialogScrim>
  );
}

// Delete-account dialog — irreversible, requires typed confirmation.
function DeleteAccountDialog({ user, onCancel, onConfirm }) {
  const email = user?.email ?? 'anya@example.com';
  const [stage, setStage] = useState('confirm'); // 'confirm' | 'done'
  const [typed, setTyped] = useState('');
  const [pw, setPw] = useState('');
  const [ack, setAck] = useState(false);
  const phrase = 'delete my account';
  const phraseMatch = typed.trim().toLowerCase() === phrase;
  const canSubmit = phraseMatch && pw.length > 0 && ack;

  const submit = () => {
    if (!canSubmit) return;
    setStage('done');
    setTimeout(() => onConfirm?.(), 1400);
  };

  return (
    <DialogScrim onDismiss={stage === 'done' ? undefined : onCancel}>
      <DialogPanel
        title={stage === 'done' ? 'Account deleted.' : 'Delete your account?'}
        eyebrow={stage === 'done'
          ? 'Signing you out…'
          : 'This is permanent. Your scores, exports, and shared links will be removed within 24 hours.'}
        onClose={stage === 'done' ? undefined : onCancel} width={520}
        footer={stage === 'done' ? null : (
          <>
            <TertiaryButton onClick={onCancel}>Keep my account</TertiaryButton>
            <PrimaryButton danger disabled={!canSubmit} onClick={submit}>
              Delete account
            </PrimaryButton>
          </>
        )}>
        {stage === 'done' ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, paddingBottom: 16 }}>
            <span style={{
              width: 40, height: 40, borderRadius: 9999,
              background: 'var(--color-surface-container)', color: 'var(--color-on-surface-variant)',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}><Icon name="check" size={20} /></span>
            <span style={{ font: '400 14px/1.5 var(--font-body)', color: 'var(--color-on-surface-variant)' }}>
              Thanks for being here. We've sent a final confirmation to{' '}
              <strong style={{ color: 'var(--color-on-surface)' }}>{email}</strong>.
            </span>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: 16 }}>
            {/* Loss summary — small inventory of what disappears */}
            <div style={{
              background: 'var(--color-surface-container-low)', borderRadius: 8,
              padding: 16, display: 'flex', flexDirection: 'column', gap: 10,
            }}>
              <Eyebrow>You'll lose</Eyebrow>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {[
                  ['music', '12 scores, including 3 collaborations'],
                  ['download', 'All MIDI and PDF exports'],
                  ['link', "4 share links — they'll stop working immediately"],
                ].map(([icon, text]) => (
                  <div key={text} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Icon name={icon} size={16} />
                    <span style={{ font: '400 13px/1.4 var(--font-body)', color: 'var(--color-on-surface)' }}>{text}</span>
                  </div>
                ))}
              </div>
            </div>

            <TextField
              label={<>Type <span style={{ font: '500 13px/1 var(--font-mono)', color: 'var(--color-on-surface)' }}>{phrase}</span> to confirm</>}
              value={typed} onChange={setTyped}
              placeholder={phrase} autoFocus
            />
            <TextField
              label="Your password"
              value={pw} onChange={setPw}
              type="password" placeholder="••••••••••••"
            />

            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)}
                style={{ marginTop: 3, accentColor: 'var(--color-error)' }} />
              <span style={{ font: '400 13px/1.5 var(--font-body)', color: 'var(--color-on-surface-variant)' }}>
                I understand this can't be undone, and that exporting my scores first is recommended.
              </span>
            </label>
          </div>
        )}
      </DialogPanel>
    </DialogScrim>
  );
}

function Settings({ user, onSave, onSignOut, recUsedSec = 0, onResetUsage, planId: planIdProp, onPlanChange }) {
  const [tab, setTab] = useState('profile');
  const [name, setName] = useState(user?.name ?? 'Anya Mokri');
  const [email, setEmail] = useState(user?.email ?? 'anya@example.com');
  const [bio, setBio] = useState('Sketches in the margins, mostly piano.');
  const [autosave, setAutosave] = useState(true);
  const [metronome, setMetronome] = useState(false);
  const [emails, setEmails] = useState(true);
  const [tips, setTips] = useState(true);
  const [changePwOpen, setChangePwOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  // In production these come from /api/polar/subscription. When App owns the
  // plan (so the editor's quota stays in sync), it passes `planId` + `onPlanChange`.
  const [planIdLocal, setPlanIdLocal] = useState(user?.planId ?? 'pro');
  const planId = planIdProp ?? planIdLocal;
  const setPlanId = onPlanChange ?? setPlanIdLocal;
  const [billing, setBilling] = useState(user?.billing ?? 'monthly');
  const [planChangedToast, setPlanChangedToast] = useState('');
  const currentPlan = SETTINGS_PLAN_TIERS.find((p) => p.id === planId);

  return (
    <main data-screen-label="Settings"
      style={{ flex: 1, maxWidth: 1024, margin: '0 auto', padding: '40px 32px',
        display: 'flex', flexDirection: 'column', gap: 32, width: '100%', boxSizing: 'border-box' }}>
      <PageHeader title="Settings" italic subtitle="Tweak your profile, defaults, and account." />

      <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 32, alignItems: 'flex-start' }}>
        {/* Side nav */}
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 4, position: 'sticky', top: 96 }}>
          {[
            ['profile', 'Profile', 'user'],
            ['editor',  'Editor defaults', 'sliders-horizontal'],
            ['notifications', 'Notifications', 'bell'],
            ['account', 'Account', 'shield'],
          ].map(([k, label, icon]) => (
            <button key={k} onClick={() => setTab(k)} style={{
              background: tab === k ? 'var(--color-surface-container)' : 'transparent',
              color: tab === k ? 'var(--color-on-surface)' : 'var(--color-on-surface-variant)',
              border: 0, borderRadius: 8, padding: '10px 14px', textAlign: 'left',
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10,
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
            <SettingsSection title="Profile" subtitle="What collaborators see when you share a score.">
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <div style={{
                  width: 64, height: 64, borderRadius: 9999,
                  background: 'var(--color-secondary-soft)',
                  color: 'var(--color-on-secondary-soft)',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  font: '600 22px/1 var(--font-label)',
                }}>{name.split(' ').map(s => s[0]).join('').slice(0,2)}</div>
                <SecondaryButton>Change photo</SecondaryButton>
              </div>
              <TextField label="Display name" value={name} onChange={setName} />
              <TextField label="Email" value={email} onChange={setEmail} type="email" />
              <TextArea label="Short bio" value={bio} onChange={setBio} rows={3} />
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <PrimaryButton emphasis="pop" onClick={onSave}>Save changes</PrimaryButton>
              </div>
            </SettingsSection>
          )}

          {tab === 'editor' && (
            <SettingsSection title="Editor defaults" subtitle="Applied to every new score you create.">
              <Switch checked={autosave} onChange={setAutosave} label="Autosave changes as I edit" />
              <Switch checked={metronome} onChange={setMetronome} label="Show metronome by default" />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <Eyebrow>Default tempo</Eyebrow>
                <div style={{ display: 'flex', gap: 6 }}>
                  {[60, 90, 120, 144].map((bpm) => (
                    <button key={bpm} style={{
                      background: bpm === 120 ? 'var(--color-primary-container)' : 'var(--color-surface-container-low)',
                      color: bpm === 120 ? 'var(--color-on-primary-container)' : 'var(--color-on-surface)',
                      border: 0, borderRadius: 4, padding: '8px 16px', cursor: 'pointer',
                      font: '500 14px/1 var(--font-mono)',
                    }}>{bpm} bpm</button>
                  ))}
                </div>
              </div>
            </SettingsSection>
          )}

          {tab === 'notifications' && (
            <SettingsSection title="Notifications" subtitle="We keep these light. Promise.">
              <Switch checked={emails} onChange={setEmails} label="Product updates by email" />
              <Switch checked={tips} onChange={setTips} label="Occasional composition tips" />
            </SettingsSection>
          )}

          {tab === 'account' && (
            <>
              <SettingsSection
                title="Plan & billing"
                subtitle={currentPlan.id === 'free'
                  ? 'You\'re on the free Sketch plan.'
                  : `Billed ${billing} through Polar. Next invoice June 12, 2026.`}>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 16, padding: 16,
                  background: 'var(--color-surface-container-low)', borderRadius: 10,
                }}>
                  <span style={{
                    width: 44, height: 44, borderRadius: 9999, flexShrink: 0,
                    background: 'var(--color-primary-container)', color: 'var(--color-on-primary-container)',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  }}><Icon name={currentPlan.icon} size={20} /></span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
                    <span style={{ font: '600 15px/1.3 var(--font-body)', color: 'var(--color-on-surface)' }}>
                      {currentPlan.name}
                    </span>
                    <span style={{ font: '400 13px/1.4 var(--font-body)', color: 'var(--color-on-surface-variant)' }}>
                      {settingsPlanPrice(currentPlan, billing)}
                      {currentPlan.id !== 'free' && ' · •••• 4242'}
                    </span>
                  </div>
                  <PrimaryButton emphasis="pop" onClick={() => setPlanOpen(true)}>Change plan</PrimaryButton>
                </div>

                {/* Today's recording usage */}
                <div style={{
                  display: 'flex', flexDirection: 'column', gap: 10,
                  padding: '14px 16px', background: 'var(--color-surface-container-low)', borderRadius: 10,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
                    <Eyebrow>Today's recording</Eyebrow>
                    <span style={{ font: '400 11px/1 var(--font-label)', color: 'var(--color-on-surface-variant)' }}>
                      Resets at midnight
                    </span>
                  </div>
                  {(() => {
                    const limit = currentPlan.dailyLimitSec;
                    const unlimited = !isFinite(limit);
                    const exhausted = !unlimited && recUsedSec >= limit;
                    const pct = unlimited ? 1 : Math.min(1, recUsedSec / limit);
                    const fmt = (s) => {
                      const v = Math.max(0, Math.floor(s));
                      if (v < 60) return `${v}s`;
                      const m = Math.floor(v / 60); const r = v % 60;
                      return `${m}:${String(r).padStart(2, '0')}`;
                    };
                    return (
                      <>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                          <span style={{
                            fontFamily: 'var(--font-display)', fontStyle: 'italic', fontWeight: 400,
                            fontSize: 28, lineHeight: 1, letterSpacing: '-0.02em',
                            color: exhausted ? 'var(--color-error)' : 'var(--color-on-surface)',
                          }}>
                            {unlimited ? '∞' : fmt(recUsedSec)}
                          </span>
                          {!unlimited && (
                            <span style={{ font: '400 13px/1 var(--font-body)', color: 'var(--color-on-surface-variant)' }}>
                              of {fmt(limit)} used
                            </span>
                          )}
                          {unlimited && (
                            <span style={{ font: '400 13px/1 var(--font-body)', color: 'var(--color-on-surface-variant)' }}>
                              No daily cap on {currentPlan.name}.
                            </span>
                          )}
                        </div>
                        <div style={{ height: 6, borderRadius: 6, background: 'var(--color-surface-container)', overflow: 'hidden' }}>
                          <div style={{
                            width: `${pct * 100}%`, height: '100%',
                            background: unlimited
                              ? 'var(--color-primary-container)'
                              : exhausted ? 'var(--color-error)'
                              : pct > 0.8 ? 'var(--color-secondary-container)'
                              : 'var(--color-primary-container)',
                            transition: 'width 200ms linear, background 200ms var(--ease)',
                          }} />
                        </div>
                        {exhausted && (
                          <div style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                            paddingTop: 4,
                          }}>
                            <span style={{ font: '400 12px/1.4 var(--font-body)', color: 'var(--color-on-surface-variant)' }}>
                              You've hit today's cap. Upgrade to keep recording, or wait until tomorrow.
                            </span>
                            <SecondaryButton onClick={() => setPlanOpen(true)}>Upgrade</SecondaryButton>
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
                {planChangedToast && (
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    background: 'var(--color-primary-soft)', color: 'var(--color-on-primary-soft)',
                    borderRadius: 8, padding: '10px 14px', font: '500 13px/1.4 var(--font-body)',
                  }}>
                    <Icon name="check" size={16} />
                    {planChangedToast}
                  </div>
                )}
                {currentPlan.id !== 'free' && (
                  <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                    <a href="#" onClick={(e) => e.preventDefault()} style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                      color: 'var(--color-primary)', font: '500 13px/1 var(--font-body)', textDecoration: 'none',
                    }}>
                      <Icon name="external-link" size={14} /> Manage billing on Polar
                    </a>
                    <a href="#" onClick={(e) => e.preventDefault()} style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                      color: 'var(--color-primary)', font: '500 13px/1 var(--font-body)', textDecoration: 'none',
                    }}>
                      <Icon name="download" size={14} /> Download past invoices
                    </a>
                  </div>
                )}
              </SettingsSection>
              <SettingsSection title="Password" subtitle="Last changed two months ago.">
                <div><SecondaryButton onClick={() => setChangePwOpen(true)}>Change password</SecondaryButton></div>
              </SettingsSection>
              <SettingsSection title="Sign out" subtitle="Log out of this browser.">
                <div><TertiaryButton onClick={onSignOut}>Sign out</TertiaryButton></div>
              </SettingsSection>
              <SettingsSection title="Delete account" subtitle="This permanently removes your scores. We can't undo it.">
                <div><TertiaryButton danger onClick={() => setDeleteOpen(true)}>Delete my account</TertiaryButton></div>
              </SettingsSection>
            </>
          )}
        </div>
      </div>
      {changePwOpen && (
        <ChangePasswordDialog
          onCancel={() => setChangePwOpen(false)}
          onSuccess={() => setChangePwOpen(false)} />
      )}
      {deleteOpen && (
        <DeleteAccountDialog
          user={{ name, email }}
          onCancel={() => setDeleteOpen(false)}
          onConfirm={() => { setDeleteOpen(false); onSignOut?.(); }} />
      )}
      {planOpen && (
        <ChangePlanDialog
          currentPlanId={planId}
          currentBilling={billing}
          onCancel={() => setPlanOpen(false)}
          onChanged={({ planId: nextId, billing: nextBilling }) => {
            const nextPlan = SETTINGS_PLAN_TIERS.find((p) => p.id === nextId);
            setPlanId(nextId);
            setBilling(nextBilling);
            setPlanOpen(false);
            setPlanChangedToast(nextId === 'free' && planId !== 'free'
              ? 'Subscription cancelled. You\'ll keep paid features until the end of the cycle.'
              : `Switched to ${nextPlan.name} (${nextBilling}).`);
            setTimeout(() => setPlanChangedToast(''), 6000);
          }} />
      )}
    </main>
  );
}

Object.assign(window, { Settings });
