// Buttons.
//
// Magenta-shadow "pop" treatment is RESERVED for at most one hero CTA per
// viewport — the landing hero and final CTA, the nav's "New score", a flow's
// single closing CTA. Every onboarding Continue stays flat.
// Use <PrimaryButton> for the everyday filled button (no shadow); use
// <PrimaryButton emphasis="pop"> for the rare hero moment.
//
// Heights are the control tokens: md 40px, lg 48px. Hover deepens the neon a
// step (primary-container-hover, label on-primary-soft). Disabled, a capsule
// drops to the tonal surface-container fill with on-surface-variant text and no
// shadow — never a faded neon.

function PrimaryButton({ children, onClick, size = 'md', icon, type = 'button', disabled, emphasis = 'flat', fullWidth, danger = false }) {
    const [hover, setHover] = useState(false)
    const big = size === 'lg'
    // Destructive variant: red fill, no magenta pop — destructive actions don't get
    // the signature lift (that's reserved for things you *want* the user to tap).
    const pop = emphasis === 'pop' && !danger
    const baseShadow = pop ? '3px 3px 0 0 var(--color-secondary-container)' : 'none'
    const hoverShadow = pop ? '5px 5px 0 0 var(--color-secondary-container)' : 'none'
    const idleBg = danger ? 'var(--color-error-container)' : 'var(--color-primary-container)'
    const hoverBg = danger ? 'var(--color-error)' : 'var(--color-primary-container-hover)'
    const idleFg = danger ? 'var(--color-on-error-container)' : 'var(--color-on-primary-container)'
    const hoverFg = danger ? 'var(--color-on-error)' : 'var(--color-on-primary-soft)'
    const lit = hover && !disabled
    return (
        <button
            type={type}
            disabled={disabled}
            onClick={onClick}
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
            style={{
                background: disabled ? 'var(--color-surface-container)' : lit ? hoverBg : idleBg,
                color: disabled ? 'var(--color-on-surface-variant)' : lit ? hoverFg : idleFg,
                border: 0,
                borderRadius: 9999,
                height: big ? 48 : 40,
                padding: big ? '0 26px' : '0 20px',
                font: big ? 'var(--type-button-lg)' : 'var(--type-button)',
                letterSpacing: '0.01em',
                cursor: disabled ? 'not-allowed' : 'pointer',
                whiteSpace: 'nowrap',
                flexShrink: 0,
                boxShadow: disabled ? 'none' : lit ? hoverShadow : baseShadow,
                transform: lit && pop ? 'translateY(-2px)' : 'translateY(0)',
                transition: 'transform 200ms var(--ease), box-shadow 200ms var(--ease), background 150ms var(--ease)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                width: fullWidth ? '100%' : undefined,
                justifyContent: fullWidth ? 'center' : undefined,
            }}>
            <span>{children}</span>
            {icon && <Icon name={icon} size={big ? 18 : 16} />}
        </button>
    )
}

function SecondaryButton({ children, onClick, size = 'md', type = 'button', disabled, fullWidth }) {
    const [hover, setHover] = useState(false)
    const big = size === 'lg'
    return (
        <button
            type={type}
            disabled={disabled}
            onClick={onClick}
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
            style={{
                // The tonal control fill: surface-container → high on hover; disabled keeps it, the label muted.
                background: hover && !disabled ? 'var(--control-fill-hover)' : 'var(--control-fill)',
                color: disabled ? 'var(--color-on-surface-variant)' : 'var(--color-on-surface)',
                border: 0,
                borderRadius: 9999,
                height: big ? 48 : 40,
                padding: big ? '0 26px' : '0 20px',
                font: big ? 'var(--type-button-lg)' : 'var(--type-button)',
                cursor: disabled ? 'not-allowed' : 'pointer',
                whiteSpace: 'nowrap',
                flexShrink: 0,
                transition: 'background 150ms var(--ease)',
                width: fullWidth ? '100%' : undefined,
            }}>
            {children}
        </button>
    )
}

function TertiaryButton({ children, onClick, danger = false }) {
    const [hover, setHover] = useState(false)
    return (
        <button
            type="button"
            onClick={onClick}
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
            style={{
                background: 'transparent',
                border: 0,
                color: danger
                    ? hover
                        ? 'var(--color-secondary-container)'
                        : 'var(--color-secondary)'
                    : hover
                      ? 'var(--color-primary)'
                      : 'var(--color-on-surface)',
                // A button's voice, Tertiary included: Space Grotesk 600 in on-surface.
                font: 'var(--type-button)',
                cursor: 'pointer',
                padding: '8px 0',
                whiteSpace: 'nowrap',
                flexShrink: 0,
                transition: 'color 150ms var(--ease)',
            }}>
            {children}
        </button>
    )
}

function IconButton({ icon, onClick, hoverTone = 'cyan', size = 32, ariaLabel, idleBg }) {
    const [hover, setHover] = useState(false)
    const hoverBg = hoverTone === 'magenta' ? 'var(--color-secondary-container)' : 'var(--color-primary-container)'
    const hoverFg = hoverTone === 'magenta' ? 'var(--color-on-secondary)' : 'var(--color-on-primary-container)'
    return (
        <button
            type="button"
            aria-label={ariaLabel}
            onClick={onClick}
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
            style={{
                width: size,
                height: size,
                borderRadius: 9999,
                background: hover ? hoverBg : idleBg || 'var(--color-surface-container)',
                color: hover ? hoverFg : 'var(--color-on-surface)',
                border: 0,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                transition: 'background 150ms var(--ease), color 150ms var(--ease)',
            }}>
            <Icon name={icon} size={size <= 28 ? 14 : 16} />
        </button>
    )
}

function ToggleButton({ active, onClick, children, tone = 'cyan', ariaLabel }) {
    const activeBg = tone === 'rec' ? 'var(--color-error)' : 'var(--color-primary-container)'
    const activeFg = tone === 'rec' ? 'var(--color-on-error)' : 'var(--color-on-primary-container)'
    return (
        <button
            type="button"
            onClick={onClick}
            aria-label={ariaLabel}
            style={{
                background: active ? activeBg : 'var(--color-surface-container-low)',
                color: active ? activeFg : 'var(--color-on-surface)',
                border: 0,
                borderRadius: 4,
                padding: '7px 11px',
                font: '600 12px/1 var(--font-label)',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                flexShrink: 0,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                minHeight: 30,
            }}>
            {children}
        </button>
    )
}

Object.assign(window, { PrimaryButton, SecondaryButton, TertiaryButton, IconButton, ToggleButton })
