// Top nav, footer, dialog scrim, sub-page header.
function TopNav({ active = 'Library', user = 'Anya M.', onCreate, onSignOut, onNav }) {
  const items = ['Library', 'Editor'];
  return (
    <nav style={{
      position: 'sticky', top: 0, zIndex: 50,
      background: 'rgba(246,246,246,0.85)', backdropFilter: 'blur(16px)',
      WebkitBackdropFilter: 'blur(16px)',
      boxShadow: '0 0 24px 0 rgba(45,47,47,0.06)',
    }}>
      <div style={{ maxWidth: 1536, margin: '0 auto',
        padding: '18px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 26 }}>
          <Wordmark size={28} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 22, marginLeft: 16 }}>
            {items.map((n) => (
              <button key={n} onClick={() => onNav?.(n.toLowerCase())} style={{
                background: 'transparent', border: 0, cursor: active === n ? 'default' : 'pointer',
                font: '500 14px/1 var(--font-body)',
                color: active === n ? 'var(--color-on-surface)' : 'var(--color-on-surface-variant)',
                borderBottom: active === n ? '2px solid var(--color-primary-container)' : '2px solid transparent',
                paddingBottom: 4, whiteSpace: 'nowrap', flexShrink: 0,
              }}>{n}</button>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <PrimaryButton onClick={onCreate} icon="plus" emphasis="pop">New score</PrimaryButton>
          <button onClick={() => onNav?.('settings')} title={user} style={{
            background: 'var(--color-surface-container)', color: 'var(--color-on-surface)',
            border: 0, borderRadius: 9999, width: 36, height: 36, cursor: 'pointer',
            font: '600 13px/1 var(--font-label)',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}>{user.split(' ').map(s => s[0]).join('').slice(0,2)}</button>
        </div>
      </div>
    </nav>
  );
}

function PageHeader({ title, subtitle, italic = false, right }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 18, paddingBottom: 18 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <PageTitle italic={italic}>{title}</PageTitle>
        {subtitle && <SubHeadline>{subtitle}</SubHeadline>}
      </div>
      {right}
    </div>
  );
}

function Footer() {
  return (
    <footer style={{
      borderTop: '1px solid rgba(172,173,173,0.15)',
      padding: '24px 0', background: 'var(--color-surface)',
    }}>
      <div style={{ maxWidth: 1536, margin: '0 auto', padding: '0 32px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Wordmark size={20} />
        <span style={{ font: '400 12px/1 var(--font-body)', color: 'var(--color-on-surface-variant)', whiteSpace: 'nowrap' }}>
          © 2026 Sheemu — built for composers.
        </span>
      </div>
    </footer>
  );
}

function DialogScrim({ children, onDismiss }) {
  return (
    <div onClick={onDismiss}
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'rgba(45,47,47,0.4)', backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}>
      <div onClick={(e) => e.stopPropagation()}>{children}</div>
    </div>
  );
}

function DialogPanel({ title, eyebrow, children, footer, onClose, width = 560 }) {
  return (
    <div style={{
      background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)',
      borderRadius: 12, boxShadow: '0 0 24px 0 rgba(45,47,47,0.06)',
      width, maxWidth: '90vw', maxHeight: '90vh', display: 'flex', flexDirection: 'column',
    }}>
      <header style={{
        padding: '24px 28px 16px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <ModalTitle>{title}</ModalTitle>
          {eyebrow && <span style={{ font: '400 13px/1.4 var(--font-body)', color: 'var(--color-on-surface-variant)' }}>{eyebrow}</span>}
        </div>
        {onClose && (
          <button onClick={onClose} aria-label="Close" style={{
            background: 'transparent', border: 0, color: 'var(--color-on-surface-variant)',
            cursor: 'pointer', padding: 4,
          }}><Icon name="x" size={20} /></button>
        )}
      </header>
      <div style={{ padding: '0 28px', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>{children}</div>
      {footer && <footer style={{
        padding: '20px 28px', display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12,
      }}>{footer}</footer>}
    </div>
  );
}

Object.assign(window, { TopNav, PageHeader, Footer, DialogScrim, DialogPanel });
