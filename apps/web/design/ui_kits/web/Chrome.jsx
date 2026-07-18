// Top nav, footer, dialog scrim, sub-page header.
function TopNav({ active = 'Library', user = 'Anya M.', onCreate, onSignOut, onNav }) {
    const items = ['Library', 'Settings']
    return (
        <nav
            style={{
                position: 'sticky',
                top: 0,
                zIndex: 50,
                // Chrome mirror surface — token-driven, same recipe as the editor header/dock.
                background: 'color-mix(in srgb, var(--color-surface-container-low) 85%, transparent)',
                backdropFilter: 'blur(24px)',
                WebkitBackdropFilter: 'blur(24px)',
                boxShadow: 'var(--shadow-tonal)',
            }}>
            <div
                style={{
                    maxWidth: 1536,
                    margin: '0 auto',
                    padding: '18px 32px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 26 }}>
                    <Wordmark size={28} />
                    <div style={{ display: 'flex', alignItems: 'center', gap: 22, marginLeft: 16 }}>
                        {items.map((n) => (
                            <button
                                key={n}
                                onClick={() => onNav?.(n.toLowerCase())}
                                style={{
                                    background: 'transparent',
                                    border: 0,
                                    cursor: active === n ? 'default' : 'pointer',
                                    font: '500 14px/1 var(--font-body)',
                                    color: active === n ? 'var(--color-on-surface)' : 'var(--color-on-surface-variant)',
                                    borderBottom: active === n ? '3px solid var(--color-primary-container)' : '3px solid transparent',
                                    paddingBottom: 4,
                                    whiteSpace: 'nowrap',
                                    flexShrink: 0,
                                }}>
                                {n}
                            </button>
                        ))}
                    </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                    <PrimaryButton onClick={onCreate} icon="plus" emphasis="pop">
                        New score
                    </PrimaryButton>
                    <button
                        onClick={() => onNav?.('settings')}
                        title={user}
                        style={{
                            background: 'var(--color-surface-container)',
                            color: 'var(--color-on-surface)',
                            border: 0,
                            borderRadius: 9999,
                            width: 36,
                            height: 36,
                            cursor: 'pointer',
                            font: '600 13px/1 var(--font-label)',
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}>
                        {user
                            .split(' ')
                            .map((s) => s[0])
                            .join('')
                            .slice(0, 2)}
                    </button>
                </div>
            </div>
        </nav>
    )
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
    )
}

function FooterLink({ children, onClick }) {
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
                padding: 0,
                cursor: 'pointer',
                font: '400 12px/1 var(--font-body)',
                color: hover ? 'var(--color-on-surface)' : 'var(--color-on-surface-variant)',
                whiteSpace: 'nowrap',
                transition: 'color 150ms var(--ease)',
            }}>
            {children}
        </button>
    )
}

function Footer() {
    return (
        <footer
            style={{
                borderTop: '1px solid color-mix(in srgb, var(--color-outline-variant) 15%, transparent)',
                padding: '24px 0',
                background: 'var(--color-surface)',
            }}>
            <div
                style={{
                    maxWidth: 1536,
                    margin: '0 auto',
                    padding: '0 32px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 24,
                    flexWrap: 'wrap',
                }}>
                <Wordmark size={20} />
                <nav aria-label="Legal" style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
                    <FooterLink>Privacy</FooterLink>
                    <FooterLink>Terms</FooterLink>
                    <FooterLink>Contact</FooterLink>
                    <FooterLink>Cookie settings</FooterLink>
                </nav>
                <span style={{ font: '400 12px/1 var(--font-body)', color: 'var(--color-on-surface-variant)', whiteSpace: 'nowrap' }}>
                    © 2026 Solkey. Made for composers.
                </span>
            </div>
        </footer>
    )
}

function DialogScrim({ children, onDismiss }) {
    return (
        <div
            onClick={onDismiss}
            style={{
                position: 'fixed',
                inset: 0,
                zIndex: 100,
                background: 'rgba(45,47,47,0.4)',
                backdropFilter: 'blur(4px)',
                WebkitBackdropFilter: 'blur(4px)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 24,
            }}>
            <div onClick={(e) => e.stopPropagation()}>{children}</div>
        </div>
    )
}

// `subtitle` matches the production DialogPanel prop; `eyebrow` is kept as a
// deprecated alias so older kit screens keep rendering.
function DialogPanel({ title, subtitle, eyebrow, children, footer, onClose, width = 560 }) {
    const sub = subtitle ?? eyebrow
    return (
        <div
            role="dialog"
            aria-modal="true"
            className="glass-panel"
            style={{
                borderRadius: 12,
                boxShadow: 'var(--shadow-tonal)',
                width,
                maxWidth: '90vw',
                maxHeight: '90vh',
                display: 'flex',
                flexDirection: 'column',
            }}>
            <header
                style={{
                    padding: '24px 28px 16px',
                    display: 'flex',
                    alignItems: 'flex-start',
                    justifyContent: 'space-between',
                }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <ModalTitle>{title}</ModalTitle>
                    {sub && (
                        <span style={{ font: '400 13px/1.4 var(--font-body)', color: 'var(--color-on-surface-variant)' }}>{sub}</span>
                    )}
                </div>
                {onClose && (
                    <button
                        onClick={onClose}
                        aria-label="Close"
                        style={{
                            background: 'transparent',
                            border: 0,
                            color: 'var(--color-on-surface-variant)',
                            cursor: 'pointer',
                            padding: 4,
                        }}>
                        <Icon name="x" size={20} />
                    </button>
                )}
            </header>
            <div style={{ padding: '0 28px', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>{children}</div>
            {footer && (
                <footer
                    style={{
                        padding: '20px 28px',
                        display: 'flex',
                        justifyContent: 'flex-end',
                        alignItems: 'center',
                        gap: 12,
                    }}>
                    {footer}
                </footer>
            )}
        </div>
    )
}

Object.assign(window, { TopNav, PageHeader, Footer, DialogScrim, DialogPanel })
