// Score editor — top toolbar + sanctuary canvas with placeholder staff.
//
// Toolbar grammar:
//   left   → segmented note-input (durations · dot · accidentals · tie)
//   center → transport, organized around the moment of capture:
//              [stop]  [PLAY]  [● RECORD]  [metro]
//            Record is the headline action; Play sits beside it slightly
//            smaller; Stop & Metronome are small satellite controls.
//   right  → tempo readout

function Segmented({ value, onChange, options, font, ariaLabel }) {
    return (
        <div
            role="group"
            aria-label={ariaLabel}
            style={{
                display: 'inline-flex',
                padding: 3,
                borderRadius: 9999,
                background: 'var(--color-surface-container-low)',
            }}>
            {options.map(([k, g]) => {
                const active = value === k
                return (
                    <button
                        key={k || 'default'}
                        onClick={() => onChange(k)}
                        style={{
                            background: active ? 'var(--color-primary-container)' : 'transparent',
                            color: active ? 'var(--color-on-primary-container)' : 'var(--color-on-surface-variant)',
                            border: 0,
                            padding: '6px 12px',
                            cursor: 'pointer',
                            borderRadius: 9999,
                            minWidth: 34,
                            fontFamily: font || 'var(--font-label)',
                            fontWeight: active ? 600 : 500,
                            fontSize: font === 'serif' ? 18 : 16,
                            lineHeight: 1,
                            transition: 'background 150ms var(--ease), color 150ms var(--ease)',
                        }}>
                        {g}
                    </button>
                )
            })}
        </div>
    )
}

function ChipToggle({ active, onClick, children, ariaLabel }) {
    const [hover, setHover] = useState(false)
    return (
        <button
            type="button"
            aria-label={ariaLabel}
            onClick={onClick}
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
            style={{
                background: active
                    ? 'var(--color-primary-container)'
                    : hover
                      ? 'var(--color-surface-container)'
                      : 'var(--color-surface-container-low)',
                color: active ? 'var(--color-on-primary-container)' : 'var(--color-on-surface)',
                border: 0,
                borderRadius: 9999,
                padding: '7px 14px',
                font: '600 13px/1 var(--font-label)',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                minHeight: 32,
                transition: 'background 150ms var(--ease), color 150ms var(--ease)',
            }}>
            {children}
        </button>
    )
}

function TransportBtn({ size, tone = 'neutral', active, onClick, ariaLabel, children }) {
    const [hover, setHover] = useState(false)

    if (tone === 'record') {
        // Concentric "rec light": white shell, thick red ring, solid red core.
        // Active state fills the whole button.
        const dotSize = Math.round(size * 0.42)
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
                    padding: 0,
                    background: active ? 'var(--color-error)' : 'var(--color-surface-container-lowest)',
                    border: `3px solid ${active ? 'var(--color-error)' : 'var(--color-error-container)'}`,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    flexShrink: 0,
                    transform: hover ? 'scale(1.04)' : 'scale(1)',
                    transition: 'transform 220ms var(--ease), background 180ms var(--ease), border-color 180ms var(--ease)',
                }}>
                <span
                    style={{
                        width: dotSize,
                        height: dotSize,
                        borderRadius: 9999,
                        background: active ? 'var(--color-on-error)' : 'var(--color-error-container)',
                        transition: 'background 180ms var(--ease)',
                        boxShadow: active ? 'none' : 'inset 0 -2px 4px rgba(0,0,0,0.18)',
                    }}
                />
            </button>
        )
    }

    if (tone === 'play') {
        // Same concentric language, cyan, with a triangle/pause glyph.
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
                    padding: 0,
                    background: active ? 'var(--color-primary-container)' : 'var(--color-surface-container-lowest)',
                    border: `3px solid var(--color-primary-container)`,
                    color: active ? 'var(--color-on-primary-container)' : 'var(--color-primary)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    flexShrink: 0,
                    transform: hover ? 'scale(1.04)' : 'scale(1)',
                    transition: 'transform 220ms var(--ease), background 180ms var(--ease), color 180ms var(--ease)',
                }}>
                {children}
            </button>
        )
    }

    // Neutral satellite (stop / metronome) — quiet tonal circle
    const bg = hover ? 'var(--color-surface-container)' : 'var(--color-surface-container-low)'
    const fg = active ? 'var(--color-primary)' : 'var(--color-on-surface-variant)'
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
                background: bg,
                color: fg,
                border: 0,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                transition: 'background 150ms var(--ease), color 150ms var(--ease)',
            }}>
            {children}
        </button>
    )
}

// Tempo popover — tap-along pad + manual input. Spacebar works while open.
function TempoPopover({ bpm, onChange, onClose }) {
    const [taps, setTaps] = useState([]) // timestamps of recent taps
    const [draft, setDraft] = useState(String(bpm))
    const [pulse, setPulse] = useState(0) // bumps each tap to flash the pad
    const popRef = React.useRef(null)
    const inputRef = React.useRef(null)

    const tappedBpm = React.useMemo(() => {
        if (taps.length < 2) return null
        const intervals = []
        for (let i = 1; i < taps.length; i++) intervals.push(taps[i] - taps[i - 1])
        const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length
        return Math.round(60000 / avg)
    }, [taps])

    const handleTap = React.useCallback(() => {
        const now = performance.now()
        setTaps((prev) => {
            // Reset if more than 2s between taps
            const last = prev[prev.length - 1]
            const next = last && now - last > 2000 ? [now] : [...prev, now].slice(-8)
            return next
        })
        setPulse((p) => p + 1)
    }, [])

    // Spacebar while popover open = tap
    React.useEffect(() => {
        const onKey = (e) => {
            if (e.code === 'Space' && document.activeElement !== inputRef.current) {
                e.preventDefault()
                handleTap()
            } else if (e.key === 'Escape') {
                onClose()
            } else if (e.key === 'Enter' && document.activeElement === inputRef.current) {
                commit()
            }
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [handleTap])

    // Click outside to dismiss
    React.useEffect(() => {
        const onClick = (e) => {
            if (popRef.current && !popRef.current.contains(e.target)) onClose()
        }
        // Defer so the opening click doesn't immediately close it
        const t = setTimeout(() => document.addEventListener('mousedown', onClick), 0)
        return () => {
            clearTimeout(t)
            document.removeEventListener('mousedown', onClick)
        }
    }, [])

    // Push tapped value into the input as it stabilizes
    React.useEffect(() => {
        if (tappedBpm) setDraft(String(tappedBpm))
    }, [tappedBpm])

    const commit = () => {
        const n = parseInt(draft, 10)
        if (n && n >= 20 && n <= 300) {
            onChange(n)
            onClose()
        }
    }

    return (
        <div
            ref={popRef}
            role="dialog"
            aria-label="Set tempo"
            className="glass-panel"
            style={{
                position: 'absolute',
                top: 'calc(100% + 10px)',
                right: 0,
                borderRadius: 12,
                padding: 16,
                width: 360,
                zIndex: 20,
                boxShadow: 'var(--shadow-tonal)',
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
            }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Eyebrow>Tempo</Eyebrow>
                <span style={{ font: '500 11px/1 var(--font-mono)', color: 'var(--color-on-surface-variant)' }}>
                    {taps.length < 2 ? 'Tap 2+ times' : `${tappedBpm} bpm · ${taps.length} taps`}
                </span>
            </div>

            {/* Big tap pad — quiet tonal surface with a cyan pulse dot */}
            <button
                type="button"
                onClick={handleTap}
                style={{
                    position: 'relative',
                    overflow: 'hidden',
                    background: 'var(--color-primary-soft)',
                    color: 'var(--color-on-primary-soft)',
                    border: 0,
                    borderRadius: 8,
                    padding: '22px 16px',
                    cursor: 'pointer',
                    textAlign: 'left',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                }}>
                <span
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        font: '600 11px/1 var(--font-label)',
                        letterSpacing: '0.14em',
                        textTransform: 'uppercase',
                        color: 'var(--color-on-surface-variant)',
                    }}>
                    <span
                        style={{
                            width: 8,
                            height: 8,
                            borderRadius: 9999,
                            background: 'var(--color-primary-container)',
                            transform: `scale(${1 + (pulse % 2) * 0.6})`,
                            transition: 'transform 120ms var(--ease)',
                        }}
                    />
                    Tap along
                </span>
                <span
                    style={{
                        fontFamily: 'var(--font-serif)',
                        fontStyle: 'italic',
                        fontWeight: 400,
                        fontSize: 20,
                        lineHeight: 1.2,
                        letterSpacing: '-0.01em',
                    }}>
                    Click or tap the spacebar in tempo
                </span>
            </button>

            {/* Manual input + submit */}
            <div style={{ display: 'flex', alignItems: 'stretch', gap: 8 }}>
                <div
                    style={{
                        position: 'relative',
                        flex: 1,
                        background: 'var(--color-surface-container-low)',
                        borderRadius: 4,
                        display: 'flex',
                        alignItems: 'center',
                        padding: '0 12px',
                    }}>
                    <input
                        ref={inputRef}
                        type="number"
                        min={20}
                        max={300}
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        aria-label="BPM"
                        style={{
                            flex: 1,
                            background: 'transparent',
                            border: 0,
                            outline: 0,
                            color: 'var(--color-on-surface)',
                            font: '500 16px/1 var(--font-body)',
                            padding: '12px 0',
                            minWidth: 0,
                        }}
                    />
                    <span
                        style={{
                            font: '500 11px/1 var(--font-label)',
                            letterSpacing: '0.12em',
                            textTransform: 'uppercase',
                            color: 'var(--color-on-surface-variant)',
                        }}>
                        bpm
                    </span>
                    <div
                        style={{
                            position: 'absolute',
                            left: 0,
                            right: 0,
                            bottom: 0,
                            height: 2,
                            background: 'var(--color-primary-container)',
                        }}
                    />
                </div>
                <PrimaryButton onClick={commit} emphasis="pop">
                    Set
                </PrimaryButton>
            </div>
        </div>
    )
}

// BPM trigger — matches ChipToggle's tappable surface so it reads as a button,
// not a label. Active = open state.
function TempoBtn({ open, bpm, onClick }) {
    const [hover, setHover] = useState(false)
    return (
        <button
            type="button"
            onClick={onClick}
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-label={`Tempo: ${bpm} bpm`}
            style={{
                background: open
                    ? 'var(--color-primary-container)'
                    : hover
                      ? 'var(--color-surface-container)'
                      : 'var(--color-surface-container-low)',
                color: open ? 'var(--color-on-primary-container)' : 'var(--color-on-surface)',
                border: 0,
                borderRadius: 9999,
                padding: '7px 14px',
                display: 'inline-flex',
                alignItems: 'baseline',
                gap: 8,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                minHeight: 32,
                transition: 'background 150ms var(--ease), color 150ms var(--ease)',
            }}>
            <span style={{ font: '400 16px/1 var(--font-display)', fontStyle: 'italic' }}>♩ =</span>
            <span style={{ font: '600 14px/1 var(--font-mono)', letterSpacing: '-0.01em' }}>{bpm}</span>
            <span
                style={{
                    font: '600 10px/1 var(--font-label)',
                    letterSpacing: '0.14em',
                    textTransform: 'uppercase',
                    opacity: 0.75,
                }}>
                bpm
            </span>
        </button>
    )
}

// Format seconds as M:SS (or just S"s" when under a minute).
function fmtRecTime(sec) {
    const s = Math.max(0, Math.floor(sec))
    if (s < 60) return `${s}s`
    const m = Math.floor(s / 60)
    const r = s % 60
    return `${m}:${String(r).padStart(2, '0')}`
}

// Usage meter that wraps the record button. Shows how much of today's daily
// recording budget remains. When `unlimited`, renders as a calm "Unlimited"
// pill — no progress bar.
function RecordingUsage({ usedSec, limitSec, recording, planName, onClickWhenExhausted }) {
    const unlimited = !isFinite(limitSec)
    const exhausted = !unlimited && usedSec >= limitSec
    const pct = unlimited ? 0 : Math.min(1, usedSec / limitSec)
    const remaining = Math.max(0, (limitSec || 0) - usedSec)

    // Compact: tier label · used / total · thin bar.
    return (
        <div
            role={exhausted ? 'button' : undefined}
            tabIndex={exhausted ? 0 : undefined}
            onClick={exhausted ? onClickWhenExhausted : undefined}
            onKeyDown={
                exhausted
                    ? (e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              onClickWhenExhausted()
                          }
                      }
                    : undefined
            }
            style={{
                position: 'absolute',
                top: 'calc(100% + 6px)',
                left: '50%',
                transform: 'translateX(-50%)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 4,
                minWidth: 132,
                cursor: exhausted ? 'pointer' : 'default',
                opacity: exhausted ? 0.95 : 1,
            }}>
            <span
                style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: 6,
                    whiteSpace: 'nowrap',
                    font: '500 11px/1 var(--font-mono)',
                    color: exhausted ? 'var(--color-error)' : 'var(--color-on-surface-variant)',
                    letterSpacing: '-0.01em',
                }}>
                {unlimited ? (
                    <>
                        <Icon name="infinity" size={12} />
                        <span>Unlimited recording</span>
                    </>
                ) : exhausted ? (
                    <span style={{ font: '600 11px/1 var(--font-label)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                        Daily limit reached
                    </span>
                ) : (
                    <>
                        <span style={{ color: recording ? 'var(--color-error)' : 'var(--color-on-surface)' }}>{fmtRecTime(usedSec)}</span>
                        <span style={{ opacity: 0.7 }}>/ {fmtRecTime(limitSec)} today</span>
                    </>
                )}
            </span>
            {!unlimited && (
                <div
                    style={{
                        width: 132,
                        height: 3,
                        borderRadius: 3,
                        overflow: 'hidden',
                        background: 'var(--color-surface-container)',
                    }}>
                    <div
                        style={{
                            width: `${pct * 100}%`,
                            height: '100%',
                            background: exhausted
                                ? 'var(--color-error)'
                                : recording
                                  ? 'var(--color-error-container)'
                                  : pct > 0.8
                                    ? 'var(--color-secondary-container)'
                                    : 'var(--color-primary-container)',
                            transition: 'width 200ms linear, background 200ms var(--ease)',
                        }}
                    />
                </div>
            )}
            <span
                style={{
                    font: '400 10px/1 var(--font-label)',
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    color: 'var(--color-on-surface-variant)',
                    opacity: 0.7,
                }}>
                {planName}
            </span>
        </div>
    )
}

// Limit-reached dialog. Tier-aware: free / pro both see an upgrade CTA;
// the secondary action acknowledges the cap ("OK, I'll wait").
function LimitReachedDialog({ planName, nextPlanName, limitSec, onUpgrade, onClose }) {
    return (
        <DialogScrim onDismiss={onClose}>
            <DialogPanel
                title={`You've used today's ${fmtRecTime(limitSec)} of recording.`}
                eyebrow={`Your ${planName} plan resets at midnight local time. Until then, playback, editing, and export still work — only mic capture pauses.`}
                onClose={onClose}
                width={480}
                footer={
                    <>
                        <TertiaryButton onClick={onClose}>OK, I'll wait</TertiaryButton>
                        {nextPlanName && (
                            <PrimaryButton emphasis="pop" icon="arrow-right" onClick={onUpgrade}>
                                Upgrade to {nextPlanName}
                            </PrimaryButton>
                        )}
                    </>
                }>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingBottom: 8 }}>
                    <div
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 14,
                            background: 'var(--color-surface-container-low)',
                            borderRadius: 10,
                            padding: 16,
                        }}>
                        <span
                            style={{
                                width: 44,
                                height: 44,
                                borderRadius: 9999,
                                flexShrink: 0,
                                background: 'var(--color-error-container)',
                                color: 'var(--color-on-error-container)',
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                            }}>
                            <Icon name="mic-off" size={20} />
                        </span>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                            <span style={{ font: '600 14px/1.3 var(--font-body)', color: 'var(--color-on-surface)' }}>
                                Recording paused until tomorrow
                            </span>
                            <span style={{ font: '400 12px/1.4 var(--font-body)', color: 'var(--color-on-surface-variant)' }}>
                                We stop capture the moment your daily budget runs out — no surprise charges, ever.
                            </span>
                        </div>
                    </div>
                    {nextPlanName && (
                        <span style={{ font: '400 13px/1.5 var(--font-body)', color: 'var(--color-on-surface-variant)' }}>
                            Upgrading to <strong style={{ color: 'var(--color-on-surface)' }}>{nextPlanName}</strong> lifts the cap
                            immediately and your remaining minutes carry over.
                        </span>
                    )}
                </div>
            </DialogPanel>
        </DialogScrim>
    )
}

function ControlBar({
    duration,
    onDuration,
    accidental,
    onAccidental,
    dotted,
    onDot,
    tied,
    onTie,
    playing,
    onPlay,
    onStop,
    recording,
    onRec,
    metro,
    onMetro,
    bpm,
    onBpm,
    recUsedSec,
    recLimitSec,
    recPlanName,
    onLimitClick,
}) {
    const [tempoOpen, setTempoOpen] = useState(false)
    return (
        <div
            style={{
                display: 'grid',
                gridTemplateColumns: '1fr auto 1fr',
                alignItems: 'center',
                gap: 16,
                padding: '14px 24px 50px',
                background: 'var(--color-surface-container-lowest)',
                boxShadow: '0 0 24px 0 rgba(45,47,47,0.06)',
            }}>
            {/* LEFT — note input */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', minWidth: 0 }}>
                <Segmented
                    ariaLabel="Note duration"
                    value={duration}
                    onChange={onDuration}
                    font="serif"
                    options={[
                        ['w', '𝅝'],
                        ['h', '𝅗𝅥'],
                        ['q', '𝅘𝅥'],
                        ['8', '𝅘𝅥𝅮'],
                        ['16', '𝅘𝅥𝅯'],
                    ]}
                />
                <ChipToggle active={dotted} onClick={onDot} ariaLabel="Dotted">
                    ·
                </ChipToggle>
                <Segmented
                    ariaLabel="Accidental"
                    value={accidental}
                    onChange={onAccidental}
                    options={[
                        ['', '♮'],
                        ['b', '♭'],
                        ['#', '♯'],
                    ]}
                />
                <ChipToggle active={tied} onClick={onTie}>
                    Tie
                </ChipToggle>
            </div>

            {/* CENTER — transport: record headlines, play next to it, satellites flank */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, position: 'relative' }}>
                <TransportBtn size={36} onClick={onStop} ariaLabel="Stop">
                    <Icon name="square" size={14} />
                </TransportBtn>
                <TransportBtn size={52} tone="play" active={playing} onClick={onPlay} ariaLabel={playing ? 'Pause' : 'Play'}>
                    <Icon name={playing ? 'pause' : 'play'} size={24} />
                </TransportBtn>
                <div style={{ position: 'relative', display: 'inline-flex', flexDirection: 'column', alignItems: 'center' }}>
                    <TransportBtn size={68} tone="record" active={recording} onClick={onRec} ariaLabel="Record">
                        <Icon name="circle" size={28} />
                    </TransportBtn>
                    <RecordingUsage
                        usedSec={recUsedSec}
                        limitSec={recLimitSec}
                        recording={recording}
                        planName={recPlanName}
                        onClickWhenExhausted={onLimitClick}
                    />
                </div>
                <TransportBtn size={36} active={metro} onClick={onMetro} ariaLabel="Metronome">
                    <Icon name="audio-lines" size={14} />
                </TransportBtn>
            </div>

            {/* RIGHT — tempo */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', position: 'relative' }}>
                <TempoBtn open={tempoOpen} bpm={bpm} onClick={() => setTempoOpen((o) => !o)} />
                {tempoOpen && <TempoPopover bpm={bpm} onChange={onBpm} onClose={() => setTempoOpen(false)} />}
            </div>
        </div>
    )
}

// Static placeholder staff — production rendering is SMuFL/Bravura.
function PlaceholderStaff() {
    const lineGap = 10
    return (
        <svg viewBox="0 0 800 220" width="100%" height="220" preserveAspectRatio="xMidYMid meet">
            {[0, 1, 2, 3, 4].map((i) => (
                <line key={i} x1={20} x2={780} y1={60 + i * lineGap} y2={60 + i * lineGap} stroke="#2d2f2f" strokeWidth={1} />
            ))}
            <text x={26} y={110} fontFamily="serif" fontSize={68} fill="#2d2f2f">
                𝄞
            </text>
            <text x={88} y={88} fontFamily="serif" fontSize={26} fontWeight="700" fill="#2d2f2f">
                4
            </text>
            <text x={88} y={108} fontFamily="serif" fontSize={26} fontWeight="700" fill="#2d2f2f">
                4
            </text>
            {[140, 220, 300, 380, 460, 540, 620, 700].map((x, i) => {
                const lineIdx = [2, 1, 0, 1, 2, 3, 2, 1][i]
                const cy = 60 + lineIdx * lineGap
                const stemUp = lineIdx >= 2
                return (
                    <g key={x}>
                        <ellipse cx={x} cy={cy} rx={6} ry={4.5} fill="#2d2f2f" transform={`rotate(-15 ${x} ${cy})`} />
                        <line
                            x1={stemUp ? x + 6 : x - 6}
                            y1={cy}
                            x2={stemUp ? x + 6 : x - 6}
                            y2={cy + (stemUp ? -32 : 32)}
                            stroke="#2d2f2f"
                            strokeWidth={1.4}
                        />
                    </g>
                )
            })}
            <circle cx={300} cy={140} r={4} fill="#00DBE9" />
            {[180, 340, 500, 660, 780].map((x) => (
                <line key={x} x1={x} x2={x} y1={60} y2={100} stroke="#2d2f2f" strokeWidth={1} />
            ))}
        </svg>
    )
}

// Tier metadata duplicated here so Editor doesn't reach across modules. In
// production this lives in a shared constants module fed by /api/polar.
const EDITOR_TIERS = {
    free: { name: 'Sketch', dailyLimitSec: 30, next: 'Composer' },
    pro: { name: 'Composer', dailyLimitSec: 600, next: 'Studio' },
    studio: { name: 'Studio', dailyLimitSec: Infinity, next: null },
}

function Editor({ score, onBack, onSettings, planId = 'free', recUsedSec = 0, onRecUsedSecChange, onUpgrade }) {
    const [duration, setDuration] = useState('q')
    const [accidental, setAccidental] = useState('')
    const [dotted, setDotted] = useState(false)
    const [tied, setTied] = useState(false)
    const [playing, setPlaying] = useState(false)
    const [recording, setRecording] = useState(false)
    const [metro, setMetro] = useState(false)
    const [bpm, setBpm] = useState(120)
    const [title, setTitle] = useState(score?.title ?? 'Untitled composition')
    const [limitDialogOpen, setLimitDialogOpen] = useState(false)

    const tier = EDITOR_TIERS[planId] ?? EDITOR_TIERS.free
    const limitSec = tier.dailyLimitSec
    const exhausted = isFinite(limitSec) && recUsedSec >= limitSec

    // Tick today's recording usage while the record button is active.
    // When the daily cap is reached, stop the recorder and open the dialog —
    // the same dialog opens when the user taps Record on an exhausted limit.
    React.useEffect(() => {
        if (!recording) return
        if (exhausted) {
            setRecording(false)
            setLimitDialogOpen(true)
            return
        }
        const id = setInterval(() => {
            onRecUsedSecChange?.((prev) => {
                const next = (prev ?? 0) + 0.1
                return next
            })
        }, 100)
        return () => clearInterval(id)
    }, [recording, exhausted])

    const handleRecClick = () => {
        if (exhausted) {
            setLimitDialogOpen(true)
            return
        }
        setRecording((r) => !r)
    }

    return (
        <div
            data-screen-label="Editor"
            style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, background: 'var(--color-surface)' }}>
            <header
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 16,
                    padding: '14px 24px',
                    background: 'rgba(246,246,246,0.85)',
                    backdropFilter: 'blur(16px)',
                    WebkitBackdropFilter: 'blur(16px)',
                    boxShadow: '0 0 24px 0 rgba(45,47,47,0.06)',
                    zIndex: 10,
                }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16, minWidth: 0, flex: 1 }}>
                    <button
                        onClick={onBack}
                        aria-label="Back"
                        style={{
                            background: 'transparent',
                            border: 0,
                            cursor: 'pointer',
                            color: 'var(--color-on-surface-variant)',
                            padding: 4,
                            display: 'inline-flex',
                        }}>
                        <Icon name="arrow-left" size={20} />
                    </button>
                    <Wordmark size={22} />
                    <div style={{ width: 1, height: 24, background: 'rgba(172,173,173,0.15)' }} />
                    <input
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        style={{
                            background: 'transparent',
                            border: 0,
                            outline: 0,
                            fontFamily: 'var(--font-serif)',
                            fontStyle: 'italic',
                            fontSize: 22,
                            color: 'var(--color-on-surface)',
                            padding: 4,
                            minWidth: 0,
                            flex: 1,
                        }}
                    />
                    <Pill>{score?.instrument ?? 'Piano'}</Pill>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <SecondaryButton>Share</SecondaryButton>
                    <PrimaryButton emphasis="pop" icon="check">
                        Save
                    </PrimaryButton>
                </div>
            </header>
            <ControlBar
                duration={duration}
                onDuration={setDuration}
                accidental={accidental}
                onAccidental={setAccidental}
                dotted={dotted}
                onDot={() => setDotted(!dotted)}
                tied={tied}
                onTie={() => setTied(!tied)}
                playing={playing}
                onPlay={() => setPlaying(!playing)}
                onStop={() => {
                    setPlaying(false)
                    setRecording(false)
                }}
                recording={recording}
                onRec={handleRecClick}
                metro={metro}
                onMetro={() => setMetro(!metro)}
                bpm={bpm}
                onBpm={setBpm}
                recUsedSec={recUsedSec}
                recLimitSec={limitSec}
                recPlanName={tier.name}
                onLimitClick={() => setLimitDialogOpen(true)}
            />
            {limitDialogOpen && (
                <LimitReachedDialog
                    planName={tier.name}
                    nextPlanName={tier.next}
                    limitSec={limitSec}
                    onClose={() => setLimitDialogOpen(false)}
                    onUpgrade={() => {
                        setLimitDialogOpen(false)
                        onUpgrade?.()
                    }}
                />
            )}
            <div style={{ flex: 1, overflow: 'auto', padding: 32 }}>
                <div
                    style={{
                        maxWidth: 960,
                        margin: '0 auto',
                        minHeight: '100%',
                        background: 'var(--color-surface-container-lowest)',
                        padding: 40,
                        boxShadow: '0 0 24px 0 rgba(45,47,47,0.06)',
                    }}>
                    <PlaceholderStaff />
                    <PlaceholderStaff />
                    <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginTop: 24 }}>
                        <SecondaryButton>Add measure</SecondaryButton>
                        <TertiaryButton>Remove last measure</TertiaryButton>
                    </div>
                </div>
            </div>
        </div>
    )
}

Object.assign(window, { Editor })
