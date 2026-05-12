// Buttons.
//
// Magenta-shadow "pop" treatment is RESERVED for the primary action on a
// surface — landing-page CTA, "Save score", "Continue" on a final step.
// Use <PrimaryButton> for the everyday filled button (no shadow); use
// <PrimaryButton emphasis="pop"> for the rare hero moment.

function PrimaryButton({ children, onClick, size = 'md', icon, type = 'button', disabled, emphasis = 'flat', fullWidth }) {
  const [hover, setHover] = useState(false);
  const big = size === 'lg';
  const pop = emphasis === 'pop';
  const baseShadow = pop ? '3px 3px 0 0 var(--color-secondary-container)' : 'none';
  const hoverShadow = pop ? '5px 5px 0 0 var(--color-secondary-container)' : 'none';
  return (
    <button type={type} disabled={disabled} onClick={onClick}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        background: hover && !disabled ? 'var(--color-primary)' : 'var(--color-primary-container)',
        color: hover && !disabled ? 'var(--color-on-primary)' : 'var(--color-on-primary-container)',
        border: 0, borderRadius: 9999,
        padding: big ? '13px 26px' : '9px 18px',
        font: `600 ${big ? 14 : 13}px/1 var(--font-label)`,
        letterSpacing: '0.01em',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        whiteSpace: 'nowrap', flexShrink: 0,
        boxShadow: hover && !disabled ? hoverShadow : baseShadow,
        transform: hover && !disabled && pop ? 'translateY(-2px)' : 'translateY(0)',
        transition: 'transform 220ms var(--ease), box-shadow 220ms var(--ease), background 150ms var(--ease)',
        display: pop || icon ? 'inline-flex' : 'inline-block',
        alignItems: 'center', gap: 8, width: fullWidth ? '100%' : undefined,
        justifyContent: fullWidth ? 'center' : undefined,
      }}>
      <span>{children}</span>
      {icon && <Icon name={icon} size={big ? 18 : 16} />}
    </button>
  );
}

function SecondaryButton({ children, onClick, size = 'md', type = 'button', disabled, fullWidth }) {
  const [hover, setHover] = useState(false);
  const big = size === 'lg';
  return (
    <button type={type} disabled={disabled} onClick={onClick}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        background: hover ? 'var(--color-surface-container)' : 'var(--color-surface-container-low)',
        color: 'var(--color-on-surface)',
        border: 0, borderRadius: 9999,
        padding: big ? '13px 26px' : '9px 18px',
        font: `600 ${big ? 14 : 13}px/1 var(--font-label)`,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        whiteSpace: 'nowrap', flexShrink: 0,
        transition: 'background 150ms var(--ease)',
        width: fullWidth ? '100%' : undefined,
      }}>
      {children}
    </button>
  );
}

function TertiaryButton({ children, onClick, danger = false }) {
  const [hover, setHover] = useState(false);
  return (
    <button type="button" onClick={onClick}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        background: 'transparent', border: 0,
        color: danger
          ? (hover ? 'var(--color-secondary-container)' : 'var(--color-secondary)')
          : (hover ? 'var(--color-primary)' : 'var(--color-on-surface-variant)'),
        font: '500 13px/1 var(--font-body)',
        cursor: 'pointer', padding: '8px 0', whiteSpace: 'nowrap', flexShrink: 0,
        transition: 'color 150ms var(--ease)',
      }}>
      {children}
    </button>
  );
}

function IconButton({ icon, onClick, hoverTone = 'cyan', size = 32, ariaLabel, idleBg }) {
  const [hover, setHover] = useState(false);
  const hoverBg = hoverTone === 'magenta' ? 'var(--color-secondary-container)' : 'var(--color-primary-container)';
  const hoverFg = hoverTone === 'magenta' ? 'var(--color-on-secondary)' : 'var(--color-on-primary-container)';
  return (
    <button type="button" aria-label={ariaLabel} onClick={onClick}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        width: size, height: size, borderRadius: 9999,
        background: hover ? hoverBg : (idleBg || 'var(--color-surface-container)'),
        color: hover ? hoverFg : 'var(--color-on-surface)',
        border: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer', transition: 'background 150ms var(--ease), color 150ms var(--ease)',
      }}>
      <Icon name={icon} size={size <= 28 ? 14 : 16} />
    </button>
  );
}

function ToggleButton({ active, onClick, children, tone = 'cyan', ariaLabel }) {
  const activeBg = tone === 'rec' ? 'var(--color-error)' : 'var(--color-primary-container)';
  const activeFg = tone === 'rec' ? 'var(--color-on-error)' : 'var(--color-on-primary-container)';
  return (
    <button type="button" onClick={onClick} aria-label={ariaLabel}
      style={{
        background: active ? activeBg : 'var(--color-surface-container-low)',
        color: active ? activeFg : 'var(--color-on-surface)',
        border: 0, borderRadius: 4, padding: '7px 11px',
        font: '600 12px/1 var(--font-label)',
        cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
        display: 'inline-flex', alignItems: 'center', gap: 6,
        minHeight: 30,
      }}>
      {children}
    </button>
  );
}

Object.assign(window, { PrimaryButton, SecondaryButton, TertiaryButton, IconButton, ToggleButton });
