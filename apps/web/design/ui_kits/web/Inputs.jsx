// Input fields — animated cyan underline on focus.
function TextField({ label, value, onChange, type = 'text', placeholder, leftIcon, rightSlot, autoFocus, hint }) {
    const [focused, setFocused] = useState(false)
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {label && <Eyebrow>{label}</Eyebrow>}
            <div
                style={{
                    background: 'var(--color-surface-container-low)',
                    borderRadius: 4,
                    position: 'relative',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: leftIcon ? '0 10px 0 36px' : '0 10px',
                }}>
                {leftIcon && (
                    <span
                        style={{
                            position: 'absolute',
                            left: 12,
                            top: '50%',
                            transform: 'translateY(-50%)',
                            color: 'var(--color-outline)',
                            display: 'inline-flex',
                        }}>
                        <Icon name={leftIcon} size={16} />
                    </span>
                )}
                <input
                    type={type}
                    value={value ?? ''}
                    placeholder={placeholder}
                    autoFocus={autoFocus}
                    onChange={(e) => onChange?.(e.target.value)}
                    onFocus={() => setFocused(true)}
                    onBlur={() => setFocused(false)}
                    style={{
                        flex: 1,
                        background: 'transparent',
                        border: 0,
                        outline: 0,
                        color: 'var(--color-on-surface)',
                        font: '400 14px/1 var(--font-body)',
                        padding: '12px 4px',
                        minWidth: 0,
                    }}
                />
                {rightSlot}
                <div
                    style={{
                        position: 'absolute',
                        left: focused ? 0 : '50%',
                        right: focused ? 0 : '50%',
                        bottom: 0,
                        height: 2,
                        background: 'var(--color-primary-container)',
                        transition: 'left 300ms var(--ease), right 300ms var(--ease)',
                    }}
                />
            </div>
            {hint && <span style={{ font: '400 12px/1.4 var(--font-body)', color: 'var(--color-on-surface-variant)' }}>{hint}</span>}
        </div>
    )
}

function TextArea({ label, value, onChange, placeholder, rows = 4 }) {
    const [focused, setFocused] = useState(false)
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {label && <Eyebrow>{label}</Eyebrow>}
            <div style={{ background: 'var(--color-surface-container-low)', borderRadius: 4, position: 'relative', padding: '0 10px' }}>
                <textarea
                    value={value ?? ''}
                    placeholder={placeholder}
                    rows={rows}
                    onChange={(e) => onChange?.(e.target.value)}
                    onFocus={() => setFocused(true)}
                    onBlur={() => setFocused(false)}
                    style={{
                        width: '100%',
                        background: 'transparent',
                        border: 0,
                        outline: 0,
                        resize: 'vertical',
                        color: 'var(--color-on-surface)',
                        font: '400 14px/1.55 var(--font-body)',
                        padding: '12px 0',
                        boxSizing: 'border-box',
                    }}
                />
                <div
                    style={{
                        position: 'absolute',
                        left: focused ? 0 : '50%',
                        right: focused ? 0 : '50%',
                        bottom: 0,
                        height: 2,
                        background: 'var(--color-primary-container)',
                        transition: 'left 300ms var(--ease), right 300ms var(--ease)',
                    }}
                />
            </div>
        </div>
    )
}

Object.assign(window, { TextField, TextArea })
