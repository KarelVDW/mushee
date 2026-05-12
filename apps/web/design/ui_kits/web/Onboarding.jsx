// Sign-up onboarding — gather context after the user creates an account.
const ONBOARDING_STEPS = ['name', 'background', 'instruments', 'source', 'tier', 'done'];

// Plan catalogue. `polarProductId` is what we hand to Polar's checkout — these
// would come from server config in production. Free is local-only (no checkout).
const PLAN_TIERS = [
  {
    id: 'free', name: 'Sketch', icon: 'feather',
    tagline: 'For trying it out.',
    priceMonthly: 0, priceYearly: 0,
    dailyLimitSec: 30,
    features: [
      '30 seconds of recording / day',
      '3 scores in your library',
      'Hum-to-notation transcription',
      'Export as PDF',
    ],
    polarProductId: null,
  },
  {
    id: 'pro', name: 'Composer', icon: 'sparkles',
    tagline: 'For regular writing.',
    priceMonthly: 8, priceYearly: 80,
    dailyLimitSec: 600,
    features: [
      '10 minutes of recording / day',
      'Unlimited scores',
      'MIDI + MusicXML export',
      'Shareable score links',
      'Editor themes & playback styles',
    ],
    popular: true,
    polarProductId: 'prod_composer_v1',
  },
  {
    id: 'studio', name: 'Studio', icon: 'gem',
    tagline: 'For teaching & teams.',
    priceMonthly: 18, priceYearly: 180,
    dailyLimitSec: Infinity,
    features: [
      'Unlimited recording',
      'Everything in Composer',
      'Up to 5 collaborators per score',
      'Custom staff templates',
      'Priority support',
    ],
    polarProductId: 'prod_studio_v1',
  },
];

function formatPrice(plan, billing) {
  if (plan.priceMonthly === 0) return { amount: 'Free', cadence: 'forever' };
  if (billing === 'yearly') {
    const monthlyEquiv = (plan.priceYearly / 12).toFixed(plan.priceYearly % 12 === 0 ? 0 : 2);
    return { amount: `$${monthlyEquiv}`, cadence: '/month, billed yearly' };
  }
  return { amount: `$${plan.priceMonthly}`, cadence: '/month' };
}

/* ─── Tier card ─── */
function TierCard({ plan, active, billing, onSelect }) {
  const price = formatPrice(plan, billing);
  const showSavings = billing === 'yearly' && plan.priceMonthly > 0;
  const savings = showSavings ? (plan.priceMonthly * 12 - plan.priceYearly) : 0;
  return (
    <button onClick={onSelect} aria-pressed={active} style={{
      position: 'relative', textAlign: 'left',
      background: active ? 'var(--color-primary-soft)' : 'var(--color-surface-container-lowest)',
      color: active ? 'var(--color-on-primary-soft)' : 'var(--color-on-surface)',
      border: 0, borderRadius: 12, padding: '20px 18px 18px',
      cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 14,
      boxShadow: active ? 'none' : '0 0 24px 0 rgba(45,47,47,0.06)',
      transition: 'background 160ms var(--ease), transform 160ms var(--ease)',
    }}>
      {plan.popular && (
        <span style={{
          position: 'absolute', top: -10, right: 14,
          background: 'var(--color-secondary-container)', color: 'var(--color-on-secondary-container)',
          font: '600 10px/1 var(--font-label)', letterSpacing: '0.12em', textTransform: 'uppercase',
          padding: '6px 10px', borderRadius: 9999,
        }}>Most picked</span>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{
          width: 32, height: 32, borderRadius: 9999, flexShrink: 0,
          background: active ? 'var(--color-on-primary-soft)' : 'var(--color-surface-container)',
          color: active ? 'var(--color-primary-soft)' : 'var(--color-primary)',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        }}><Icon name={plan.icon} size={18} /></span>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ font: '600 15px/1.2 var(--font-body)' }}>{plan.name}</span>
          <span style={{ font: '400 12px/1.3 var(--font-body)', opacity: 0.8 }}>{plan.tagline}</span>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span style={{
          fontFamily: 'var(--font-display)', fontStyle: 'italic', fontWeight: 400,
          fontSize: 32, lineHeight: 1, letterSpacing: '-0.02em',
        }}>{price.amount}</span>
        <span style={{ font: '400 12px/1.3 var(--font-body)', opacity: 0.8 }}>{price.cadence}</span>
      </div>
      {showSavings && (
        <Eyebrow style={{ color: active ? 'inherit' : 'var(--color-primary)' }}>Save ${savings}/yr</Eyebrow>
      )}
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {plan.features.map((f) => (
          <li key={f} style={{ display: 'flex', alignItems: 'flex-start', gap: 8,
            font: '400 13px/1.4 var(--font-body)' }}>
            <span style={{ marginTop: 1, opacity: 0.8 }}><Icon name="check" size={14} /></span>
            {f}
          </li>
        ))}
      </ul>
    </button>
  );
}

function BillingToggle({ value, onChange }) {
  return (
    <div role="radiogroup" aria-label="Billing cadence" style={{
      display: 'inline-flex', padding: 3, borderRadius: 9999,
      background: 'var(--color-surface-container-low)',
      alignSelf: 'flex-start',
    }}>
      {[['monthly','Monthly'], ['yearly','Yearly · save 17%']].map(([k, label]) => {
        const active = value === k;
        return (
          <button key={k} type="button" role="radio" aria-checked={active}
            onClick={() => onChange(k)} style={{
              background: active ? 'var(--color-surface-container-lowest)' : 'transparent',
              color: active ? 'var(--color-on-surface)' : 'var(--color-on-surface-variant)',
              boxShadow: active ? '0 1px 3px rgba(45,47,47,0.08)' : 'none',
              border: 0, padding: '7px 14px', borderRadius: 9999, cursor: 'pointer',
              font: '600 12px/1 var(--font-label)',
              transition: 'background 150ms var(--ease), color 150ms var(--ease)',
            }}>{label}</button>
        );
      })}
    </div>
  );
}

const REFERRAL_SOURCES = [
  ['friend',     'A friend told me'],
  ['search',     'Found it on a search engine'],
  ['social',     'Saw it on social media'],
  ['youtube',    'Saw it on YouTube'],
  ['teacher',    'My teacher recommended it'],
  ['blog',       'Read about it in an article'],
  ['other',      'Somewhere else'],
];

const BACKGROUNDS = [
  ['curious',     'Just curious',           'I tinker with melodies sometimes.'],
  ['hobbyist',    'Hobbyist',               'I play for myself — a few years in.'],
  ['student',     'Student',                'Studying music formally right now.'],
  ['teacher',     'Teacher',                'I teach others to play or compose.'],
  ['composer',    'Composer / arranger',    'I write or arrange music regularly.'],
  ['professional','Performing musician',    'I gig, record, or perform for a living.'],
];

const PRIMARY_INSTRUMENTS = [
  'Piano', 'Guitar', 'Violin', 'Cello', 'Flute', 'Clarinet',
  'Voice', 'Trumpet', 'Drums', 'Bass', 'Other', 'I don\'t play (yet)',
];

function OptionCard({ active, onClick, title, body, icon }) {
  return (
    <button onClick={onClick} style={{
      textAlign: 'left',
      background: active ? 'var(--color-primary-soft)' : 'var(--color-surface-container-lowest)',
      color: active ? 'var(--color-on-primary-soft)' : 'var(--color-on-surface)',
      border: 0, borderRadius: 8, padding: '18px 20px',
      cursor: 'pointer', display: 'flex', gap: 14, alignItems: 'flex-start',
      boxShadow: active ? 'none' : '0 0 24px 0 rgba(45,47,47,0.06)',
      transition: 'background 150ms var(--ease)',
    }}>
      {icon && <span style={{ marginTop: 2 }}><Icon name={icon} size={20} /></span>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ font: '600 15px/1.2 var(--font-body)' }}>{title}</span>
        {body && <span style={{ font: '400 13px/1.4 var(--font-body)', color: active ? 'var(--color-on-primary-container)' : 'var(--color-on-surface-variant)', opacity: 0.85 }}>{body}</span>}
      </div>
    </button>
  );
}

function StepProgress({ step, total }) {
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      {Array.from({ length: total }).map((_, i) => (
        <div key={i} style={{
          height: 4, borderRadius: 4, flex: 1, maxWidth: 48,
          background: i <= step ? 'var(--color-primary-container)' : 'var(--color-surface-container)',
          transition: 'background 220ms var(--ease)',
        }} />
      ))}
      <Eyebrow style={{ marginLeft: 8 }}>{Math.min(step + 1, total)} of {total}</Eyebrow>
    </div>
  );
}

function Onboarding({ onComplete, onSkip }) {
  const [step, setStep] = useState(0);
  const [data, setData] = useState({
    name: '', background: null, instruments: [], source: null, sourceDetail: '',
    email: 'composer@sheemu.io', verified: false, code: '', resending: false, resent: false,
    micState: 'idle', // 'idle' | 'requesting' | 'granted' | 'denied'
    tier: 'pro', billing: 'monthly',
    checkout: 'idle', // 'idle' | 'redirecting' | 'success' | 'cancelled' | 'error'
    checkoutError: '',
  });

  const totalSteps = 7; // verify + mic + name + background + instruments + source + tier (+done state)

  // Polar checkout — in production this hands off to Polar's hosted checkout.
  // We open a Polar session URL and listen for the return redirect.
  const startCheckout = async () => {
    const plan = PLAN_TIERS.find((p) => p.id === data.tier);
    if (!plan) return;
    // Free tier: skip Polar entirely, mark as success locally.
    if (!plan.polarProductId) {
      setField('checkout', 'success');
      return;
    }
    setField('checkout', 'redirecting');
    try {
      // Production:
      //   const session = await fetch('/api/polar/checkout', {
      //     method: 'POST',
      //     body: JSON.stringify({ productId: plan.polarProductId, billing: data.billing,
      //       successUrl: `${origin}/onboarding?checkout=success`,
      //       cancelUrl:  `${origin}/onboarding?checkout=cancelled` }),
      //   }).then(r => r.json());
      //   window.location.href = session.url; // Polar-hosted page
      // Mock — pretend Polar bounces us back to ?checkout=success after 1.6s.
      await new Promise((r) => setTimeout(r, 1600));
      setField('checkout', 'success');
    } catch (err) {
      setField('checkoutError', err.message || 'Couldn\'t reach Polar.');
      setField('checkout', 'error');
    }
  };

  // Honor `?checkout=success|cancelled` on return from Polar.
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get('checkout');
    if (result === 'success' || result === 'cancelled') {
      setData((d) => ({ ...d, checkout: result }));
      setStep(6);
    }
  }, []);

  // Ask the browser for mic access only after the user explicitly clicks Allow.
  const requestMic = async () => {
    setField('micState', 'requesting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop()); // release immediately — we only need permission
      setField('micState', 'granted');
    } catch (_e) {
      setField('micState', 'denied');
    }
  };
  const setField = (k, v) => setData((d) => ({ ...d, [k]: v }));
  const toggleInstrument = (i) => setData((d) => ({
    ...d, instruments: d.instruments.includes(i)
      ? d.instruments.filter(x => x !== i)
      : [...d.instruments, i],
  }));

  const next = () => setStep((s) => Math.min(s + 1, totalSteps));
  const back = () => setStep((s) => Math.max(s - 1, 0));

  const canAdvance = (() => {
    switch (step) {
      case 0: return data.verified;
      case 1: return data.micState === 'granted';
      case 2: return data.name.trim().length > 0;
      case 3: return !!data.background;
      case 4: return data.instruments.length > 0;
      case 5: return !!data.source;
      case 6: return data.checkout === 'success';
      default: return true;
    }
  })();

  // Mock: any 6-digit numeric code verifies.
  const submitCode = () => {
    if (/^\d{6}$/.test(data.code)) setField('verified', true);
  };

  return (
    <main data-screen-label={`Onboarding · step ${step + 1}`} style={{
      minHeight: '100vh', background: 'var(--color-surface)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '32px 24px',
    }}>
      <header style={{ width: '100%', maxWidth: 720, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Wordmark size={26} />
        {step > 0 && step < totalSteps
          ? <TertiaryButton onClick={onSkip}>Skip for now</TertiaryButton>
          : <span />}
      </header>

      <div style={{
        width: '100%', maxWidth: 720, marginTop: 48,
        background: 'var(--color-surface-container-lowest)', borderRadius: 16,
        boxShadow: '0 0 24px 0 rgba(45,47,47,0.06)',
        padding: '40px 48px', display: 'flex', flexDirection: 'column', gap: 28,
      }}>
        {step < totalSteps && <StepProgress step={step} total={totalSteps} />}

        {step === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <ModalTitle>Verify your email.</ModalTitle>
            <SubHeadline>
              We sent a 6-digit code to <strong style={{ color: 'var(--color-on-surface)' }}>{data.email}</strong>.
              Enter it below to continue — this step is required to protect your scores.
            </SubHeadline>

            {!data.verified ? (
              <>
                <div style={{ maxWidth: 280 }}>
                  <TextField
                    label="Verification code"
                    value={data.code}
                    onChange={(v) => setField('code', v.replace(/\D/g, '').slice(0, 6))}
                    placeholder="••••••"
                    autoFocus
                  />
                </div>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                  <PrimaryButton
                    disabled={!/^\d{6}$/.test(data.code)}
                    emphasis="pop"
                    onClick={submitCode}>
                    Verify
                  </PrimaryButton>
                  <TertiaryButton onClick={() => {
                    setField('resending', true);
                    setTimeout(() => { setField('resending', false); setField('resent', true); }, 600);
                  }}>
                    {data.resending ? 'Sending…' : data.resent ? 'Code sent again' : 'Resend code'}
                  </TertiaryButton>
                </div>
                <span style={{ font: '400 12px/1.4 var(--font-body)', color: 'var(--color-on-surface-variant)' }}>
                  Wrong address? <a href="#" style={{ color: 'var(--color-primary)' }}>Use a different email</a>.
                </span>
              </>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12,
                background: 'var(--color-surface-container-low)', borderRadius: 8, padding: '14px 16px' }}>
                <span style={{
                  width: 28, height: 28, borderRadius: 9999,
                  background: 'var(--color-primary-container)', color: 'var(--color-on-primary-container)',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}><Icon name="check" size={16} /></span>
                <span style={{ font: '500 14px/1.3 var(--font-body)', color: 'var(--color-on-surface)' }}>
                  Email verified. You can continue.
                </span>
              </div>
            )}
          </div>
        )}

        {step === 1 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <ModalTitle>Allow microphone access.</ModalTitle>
            <SubHeadline>
              Sheemu listens through your microphone to transcribe what you play or hum into notation. We only record while you tap Record — never in the background.
            </SubHeadline>

            <div style={{
              display: 'flex', alignItems: 'flex-start', gap: 16,
              background: 'var(--color-surface-container-low)', borderRadius: 8,
              padding: 20,
            }}>
              <span style={{
                width: 48, height: 48, borderRadius: 9999, flexShrink: 0,
                background: data.micState === 'granted' ? 'var(--color-primary-container)'
                  : data.micState === 'denied' ? 'var(--color-error-container)'
                  : 'var(--color-surface-container)',
                color: data.micState === 'granted' ? 'var(--color-on-primary-container)'
                  : data.micState === 'denied' ? 'var(--color-on-error-container)'
                  : 'var(--color-on-surface)',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                transition: 'background 180ms var(--ease), color 180ms var(--ease)',
              }}>
                <Icon name={data.micState === 'granted' ? 'check' : data.micState === 'denied' ? 'mic-off' : 'mic'} size={22} />
              </span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
                <span style={{ font: '600 15px/1.3 var(--font-body)', color: 'var(--color-on-surface)' }}>
                  {data.micState === 'granted' && 'Microphone connected.'}
                  {data.micState === 'denied'  && 'Microphone blocked.'}
                  {data.micState === 'requesting' && 'Waiting for your browser…'}
                  {data.micState === 'idle'    && 'Microphone access needed'}
                </span>
                <span style={{ font: '400 13px/1.5 var(--font-body)', color: 'var(--color-on-surface-variant)' }}>
                  {data.micState === 'granted' && 'You\'re ready to record. Tap Continue.'}
                  {data.micState === 'denied'  && 'We can\'t enable audio capture without permission. Update site permissions in your browser, then try again.'}
                  {data.micState === 'requesting' && 'Your browser will ask you to confirm in a moment.'}
                  {data.micState === 'idle'    && 'When you tap Allow, your browser will ask for permission.'}
                </span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              {data.micState !== 'granted' && (
                <PrimaryButton emphasis="pop" onClick={requestMic}
                  disabled={data.micState === 'requesting'}
                  icon={data.micState === 'denied' ? 'refresh-cw' : 'mic'}>
                  {data.micState === 'denied' ? 'Try again' : data.micState === 'requesting' ? 'Asking…' : 'Allow microphone'}
                </PrimaryButton>
              )}
              <span style={{ font: '400 12px/1.4 var(--font-body)', color: 'var(--color-on-surface-variant)' }}>
                You can revoke this any time from Settings.
              </span>
            </div>
          </div>
        )}

        {step === 2 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <ModalTitle>What should we call you?</ModalTitle>
            <SubHeadline>This shows up on your scores and lets us greet you properly.</SubHeadline>
            <TextField label="Name" value={data.name} onChange={(v) => setField('name', v)}
              placeholder="Anya Mokri" autoFocus />
          </div>
        )}

        {step === 3 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <ModalTitle>Where are you in your musical life?</ModalTitle>
            <SubHeadline>We tune the editor's defaults and tutorials to your level — pick the closest match.</SubHeadline>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {BACKGROUNDS.map(([k, t, b]) => (
                <OptionCard key={k} active={data.background === k}
                  onClick={() => setField('background', k)} title={t} body={b} />
              ))}
            </div>
          </div>
        )}

        {step === 4 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <ModalTitle>Which instruments do you play?</ModalTitle>
            <SubHeadline>Pick any that apply — or none, if you're more of a listener. We'll suggest staff layouts based on this.</SubHeadline>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {PRIMARY_INSTRUMENTS.map((i) => (
                <Chip key={i} size="md"
                  active={data.instruments.includes(i)}
                  onClick={() => toggleInstrument(i)}>
                  {i}
                </Chip>
              ))}
            </div>
          </div>
        )}

        {step === 6 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <ModalTitle>Pick a plan to start with.</ModalTitle>
              <SubHeadline>
                You can switch or cancel any time from Settings. Payments are processed by Polar.
              </SubHeadline>
            </div>

            {data.checkout === 'idle' && (
              <>
                <BillingToggle value={data.billing} onChange={(v) => setField('billing', v)} />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                  {PLAN_TIERS.map((p) => (
                    <TierCard key={p.id} plan={p} billing={data.billing}
                      active={data.tier === p.id}
                      onSelect={() => setField('tier', p.id)} />
                  ))}
                </div>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  font: '400 12px/1.4 var(--font-body)', color: 'var(--color-on-surface-variant)',
                }}>
                  <Icon name="lock" size={14} />
                  Card details are entered on Polar's secure checkout — Sheemu never sees them.
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <PrimaryButton emphasis="pop" onClick={startCheckout}
                    icon={PLAN_TIERS.find((p) => p.id === data.tier)?.polarProductId ? 'external-link' : 'arrow-right'}>
                    {PLAN_TIERS.find((p) => p.id === data.tier)?.polarProductId
                      ? 'Continue to Polar checkout'
                      : 'Start with Sketch'}
                  </PrimaryButton>
                </div>
              </>
            )}

            {data.checkout === 'redirecting' && (
              <div style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14,
                padding: '32px 16px',
                background: 'var(--color-surface-container-low)', borderRadius: 12,
              }}>
                <div style={{
                  width: 44, height: 44, borderRadius: 9999,
                  border: '3px solid var(--color-surface-container)',
                  borderTopColor: 'var(--color-primary)',
                  animation: 'sheemu-spin 700ms linear infinite',
                }} />
                <style>{`@keyframes sheemu-spin { to { transform: rotate(360deg); } }`}</style>
                <span style={{ font: '600 15px/1.3 var(--font-body)', color: 'var(--color-on-surface)' }}>
                  Redirecting you to Polar's secure checkout…
                </span>
                <span style={{ font: '400 12px/1.5 var(--font-body)', color: 'var(--color-on-surface-variant)', textAlign: 'center', maxWidth: 320 }}>
                  Once you complete payment, you'll come back here automatically.
                </span>
              </div>
            )}

            {data.checkout === 'success' && (
              <div style={{
                display: 'flex', alignItems: 'flex-start', gap: 14,
                background: 'var(--color-surface-container-low)', borderRadius: 12, padding: 20,
              }}>
                <span style={{
                  width: 40, height: 40, borderRadius: 9999, flexShrink: 0,
                  background: 'var(--color-primary-container)', color: 'var(--color-on-primary-container)',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                }}><Icon name="check" size={20} /></span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ font: '600 15px/1.3 var(--font-body)', color: 'var(--color-on-surface)' }}>
                    You're on <strong>{PLAN_TIERS.find((p) => p.id === data.tier)?.name}</strong>.
                  </span>
                  <span style={{ font: '400 13px/1.5 var(--font-body)', color: 'var(--color-on-surface-variant)' }}>
                    {PLAN_TIERS.find((p) => p.id === data.tier)?.polarProductId
                      ? 'Polar sent your receipt by email. You can manage billing any time from Settings → Billing.'
                      : 'No card needed. Upgrade later from Settings → Billing.'}
                  </span>
                </div>
              </div>
            )}

            {data.checkout === 'cancelled' && (
              <div style={{
                display: 'flex', flexDirection: 'column', gap: 12,
                background: 'var(--color-surface-container-low)', borderRadius: 12, padding: 20,
              }}>
                <span style={{ font: '600 15px/1.3 var(--font-body)', color: 'var(--color-on-surface)' }}>
                  Checkout cancelled — no charge.
                </span>
                <span style={{ font: '400 13px/1.5 var(--font-body)', color: 'var(--color-on-surface-variant)' }}>
                  Pick a plan to try again, or stick with Sketch for now.
                </span>
                <div style={{ display: 'flex', gap: 10 }}>
                  <SecondaryButton onClick={() => setField('checkout', 'idle')}>Pick a plan</SecondaryButton>
                  <TertiaryButton onClick={() => { setField('tier', 'free'); setField('checkout', 'success'); }}>
                    Continue on Sketch
                  </TertiaryButton>
                </div>
              </div>
            )}

            {data.checkout === 'error' && (
              <div style={{
                display: 'flex', flexDirection: 'column', gap: 10,
                background: 'var(--color-error-container)', color: 'var(--color-on-error-container)',
                borderRadius: 12, padding: 20,
              }}>
                <span style={{ font: '600 15px/1.3 var(--font-body)' }}>We couldn't open the checkout.</span>
                <span style={{ font: '400 13px/1.5 var(--font-body)' }}>
                  {data.checkoutError || 'Polar didn\'t respond. Check your connection and try again.'}
                </span>
                <div><SecondaryButton onClick={() => setField('checkout', 'idle')}>Try again</SecondaryButton></div>
              </div>
            )}
          </div>
        )}

        {step === 5 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <ModalTitle>How did you find Sheemu?</ModalTitle>
            <SubHeadline>Helps us know what's working — entirely optional, no wrong answers.</SubHeadline>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {REFERRAL_SOURCES.map(([k, label]) => (
                <button key={k} onClick={() => setField('source', k)} style={{
                  textAlign: 'left',
                  background: data.source === k ? 'var(--color-primary-soft)' : 'var(--color-surface-container-low)',
                  color: data.source === k ? 'var(--color-on-primary-soft)' : 'var(--color-on-surface)',
                  border: 0, borderRadius: 6, padding: '12px 16px', cursor: 'pointer',
                  font: '500 14px/1.3 var(--font-body)',
                }}>{label}</button>
              ))}
            </div>
            {data.source && (
              <TextField label="Anything else? (optional)" value={data.sourceDetail}
                onChange={(v) => setField('sourceDetail', v)}
                placeholder={data.source === 'friend' ? 'Who, if you don\'t mind sharing?' : 'A name, channel, or link'} />
            )}
          </div>
        )}

        {step === totalSteps && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20, alignItems: 'flex-start', paddingTop: 16 }}>
            <div style={{ width: 56, height: 56, borderRadius: 9999,
              background: 'var(--color-primary-container)', color: 'var(--color-on-primary-container)',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="check" size={28} />
            </div>
            <ModalTitle>You're all set, {data.name.split(' ')[0] || 'there'}.</ModalTitle>
            <SubHeadline>
              Your library is ready on <strong>{PLAN_TIERS.find((p) => p.id === data.tier)?.name}</strong>.
              Start a fresh score, or take the editor for a spin.
            </SubHeadline>
            <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
              <PrimaryButton emphasis="pop" icon="arrow-right" onClick={() => onComplete(data)}>Open my library</PrimaryButton>
            </div>
          </div>
        )}

        {step < totalSteps && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 12 }}>
            {step > 0
              ? <TertiaryButton onClick={back}>← Back</TertiaryButton>
              : <span />}
            <PrimaryButton disabled={!canAdvance} icon="arrow-right" emphasis="pop" onClick={next}>
              {step === totalSteps - 1 ? 'Finish' : 'Continue'}
            </PrimaryButton>
          </div>
        )}
      </div>
    </main>
  );
}

Object.assign(window, { Onboarding });
