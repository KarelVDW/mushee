// Brand primitives — Wordmark, Eyebrow, headers
const { useState, useEffect, useRef, useLayoutEffect } = React;

function Wordmark({ size = 28, color = 'var(--color-on-surface)' }) {
  return (
    <span style={{
      fontFamily: 'var(--font-display)', fontWeight: 700, fontStyle: 'italic',
      fontSize: size, lineHeight: 1, letterSpacing: '-0.04em', color,
    }}>Sheemu</span>
  );
}

// AppIcon — the "S" from the Sheemu wordmark, rendered with a single offset
// secondary-container drop-shadow behind the letter. Depth scales with `size`.
function AppIcon({ size = 96, rounded = true, background = 'var(--color-surface-container-lowest)' }) {
  // Shadow offset in viewBox units — scales with size.
  const vb = 100;
  const unit = vb * 0.045;
  // Italic lean — display italic shifts visual mass up-right relative to the
  // bbox centre. Nudge the whole group left by a small fraction of the em so
  // the letter reads as optically centred despite the slant.
  const italicNudge = vb * 0.04;
  // Measure the rendered glyph's bbox in useLayoutEffect so we can centre by
  // INK rather than by em-box (italic + display fonts have asymmetric
  // sidebearings + ascenders that throw off textAnchor/dominantBaseline).
  // We offset the letter by -unit/2 and the shadow by +unit/2 from the group
  // centre, so the combined letter+shadow shape is centred — not just the
  // top (letter) layer.
  const letterRef = useRef(null);
  const groupRef = useRef(null);
  const [transform, setTransform] = useState('');
  useLayoutEffect(() => {
    if (!letterRef.current) return;
    const apply = () => {
      try {
        const b = letterRef.current.getBBox();
        // Letter bbox centre, then shift group so combined shape is centred:
        // letter contributes (-unit/2, -unit/2), shadow contributes (+unit/2, +unit/2),
        // so the combined centre equals the letter centre — and we just need
        // to put the letter centre at (vb/2, vb/2).
        const cx = b.x + b.width / 2;
        const cy = b.y + b.height / 2;
        setTransform(`translate(${vb / 2 - cx - italicNudge} ${vb / 2 - cy})`);
      } catch (e) { /* font not ready */ }
    };
    apply();
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(apply);
    }
  }, [size]);
  return (
    <span aria-label="Sheemu app icon" role="img" style={{
      display: 'inline-flex', width: size, height: size, flexShrink: 0,
      background, borderRadius: rounded ? Math.round(size * 0.22) : 0,
      overflow: 'hidden',
    }}>
      <svg viewBox={`0 0 ${vb} ${vb}`} width={size} height={size}
        style={{ display: 'block' }} aria-hidden="true">
        <g ref={groupRef} transform={transform}>
          {/* Shadow — offset by +unit/2 from group centre */}
          <text x={unit / 2} y={unit / 2}
            fontFamily="var(--font-display)" fontStyle="italic" fontWeight="700"
            fontSize={vb * 0.86} letterSpacing="-0.04em"
            fill="var(--color-secondary-container)">S</text>
          {/* Letter — offset by -unit/2 from group centre (measured) */}
          <text ref={letterRef} x={-unit / 2} y={-unit / 2}
            fontFamily="var(--font-display)" fontStyle="italic" fontWeight="700"
            fontSize={vb * 0.86} letterSpacing="-0.04em"
            fill="var(--color-primary-container)">S</text>
        </g>
      </svg>
    </span>
  );
}

function Eyebrow({ children, color = 'var(--color-on-surface-variant)', style }) {
  return (
    <span style={{
      font: '600 11px/1 var(--font-label)', letterSpacing: '0.1em',
      textTransform: 'uppercase', color, ...style,
    }}>{children}</span>
  );
}

function PageTitle({ children, italic = false }) {
  return (
    <h1 style={{
      fontFamily: 'var(--font-display)', fontWeight: 700,
      fontStyle: italic ? 'italic' : 'normal',
      fontSize: 44, lineHeight: 1, letterSpacing: '-0.03em',
      color: 'var(--color-on-surface)', margin: 0,
    }}>{children}</h1>
  );
}

function ModalTitle({ children }) {
  return (
    <h2 style={{
      fontFamily: 'var(--font-display)', fontWeight: 700,
      fontSize: 28, lineHeight: 1.05, letterSpacing: '-0.025em',
      color: 'var(--color-on-surface)', margin: 0,
    }}>{children}</h2>
  );
}

function SubHeadline({ children }) {
  return (
    <p style={{
      font: '400 15px/1.5 var(--font-body)',
      color: 'var(--color-on-surface-variant)', margin: 0,
    }}>{children}</p>
  );
}

function Pill({ children, tone = 'neutral', bg, fg }) {
  const palette = {
    neutral: ['var(--color-surface-container)', 'var(--color-on-surface)'],
    cyan:    ['var(--color-primary-container)', 'var(--color-on-primary-container)'],
    magenta: ['var(--color-secondary-container)', 'var(--color-on-secondary-container)'],
  }[tone];
  return (
    <span style={{
      background: bg || palette[0], color: fg || palette[1], borderRadius: 9999,
      padding: '4px 10px',
      font: '600 11px/1 var(--font-label)',
      whiteSpace: 'nowrap',
    }}>{children}</span>
  );
}

// Chip — instrument / genre tag. Identity by default, soft-magenta when active.
// Use for selectable identity tags (instruments, genres). Loud actions belong on a button.
// `size`: 'sm' (default — list/row identity) | 'md' (form context, matches body text)
function Chip({ active, onClick, children, ariaLabel, size = 'sm' }) {
  const [hover, setHover] = useState(false);
  const interactive = !!onClick;
  const bg = active
    ? 'var(--color-secondary-soft)'
    : hover && interactive ? 'var(--color-surface-container-high)' : 'var(--color-surface-container)';
  const fg = active ? 'var(--color-on-secondary-soft)' : 'var(--color-on-surface)';
  const sizing = size === 'md'
    ? { padding: '10px 18px', font: '500 14px/1 var(--font-body)', letterSpacing: 'normal' }
    : { padding: '6px 14px',  font: '700 11px/1 var(--font-label)', letterSpacing: '0.04em' };
  return (
    <button type="button" aria-label={ariaLabel} aria-pressed={active}
      onClick={onClick}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        background: bg, color: fg, border: 0, cursor: interactive ? 'pointer' : 'default',
        borderRadius: 9999,
        display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
        transition: 'background 150ms var(--ease), color 150ms var(--ease)',
        ...sizing,
      }}>{children}</button>
  );
}

Object.assign(window, { Wordmark, AppIcon, Eyebrow, PageTitle, ModalTitle, SubHeadline, Pill, Chip });
