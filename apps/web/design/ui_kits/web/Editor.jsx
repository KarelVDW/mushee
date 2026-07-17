// Score editor — slim header + sanctuary canvas + bottom-docked note tool bar.
//
// Chrome grammar (mirrors apps/web/src/app/scores/[id]):
//   header (slim, py-2) → back · wordmark · title · instrument chip
//                          | transport centred: [stop 30] [play 40] [● record 40] [metro 30]
//                          | keyboard-shortcuts chip · Export menu
//   dock (bottom, in-flow) → every selection-scoped edit control in one bar along the
//                            editor's bottom edge: durations (SVG note icons) · dot/tuplet/
//                            rest/tie · accidentals · clef/key/tempo. Groups are separated
//                            by space — no dividers — and wrap onto extra rows. Popovers
//                            open UPWARD, away from the dock.
//   Both chrome surfaces are the same tonal mirror: surface-container-low @ 85% +
//   backdrop blur + tonal shadow. Saving is silent autosave — no Save or Share buttons.
//
// Mobile (<768px), not depicted in this desktop kit: the transport moves out of the
// header into the dock as a thumb-sized action row (record grows to 54px, the biggest
// control on screen) alongside note-nav + pitch-nudge buttons, the metronome joins the
// tool strip, and the dock popovers become full-width sheets instead of anchored panels.

// Chrome mirror surface — shared by the header and the dock.
const CHROME_SURFACE = {
    background: 'color-mix(in srgb, var(--color-surface-container-low) 85%, transparent)',
    backdropFilter: 'blur(24px)',
    WebkitBackdropFilter: 'blur(24px)',
    boxShadow: 'var(--shadow-tonal)',
}

function Segmented({ value, onChange, options, ariaLabel }) {
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
                        aria-pressed={active}
                        onClick={() => onChange(k)}
                        style={{
                            background: active ? 'var(--color-primary-container)' : 'transparent',
                            color: active ? 'var(--color-on-primary-container)' : 'var(--color-on-surface-variant)',
                            border: 0,
                            padding: '6px 10px',
                            cursor: 'pointer',
                            borderRadius: 9999,
                            minWidth: 34,
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            font: '600 14px/1 var(--font-label)',
                            transition: 'background 150ms var(--ease), color 150ms var(--ease)',
                        }}>
                        {g}
                    </button>
                )
            })}
        </div>
    )
}

function ChipToggle({ active, onClick, children, ariaLabel, disabled }) {
    const [hover, setHover] = useState(false)
    return (
        <button
            type="button"
            aria-label={ariaLabel}
            aria-pressed={active}
            disabled={disabled}
            onClick={onClick}
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
            style={{
                background: active
                    ? 'var(--color-primary-container)'
                    : hover && !disabled
                      ? 'var(--color-surface-container)'
                      : 'var(--color-surface-container-low)',
                color: active ? 'var(--color-on-primary-container)' : 'var(--color-on-surface)',
                border: 0,
                borderRadius: 9999,
                padding: '7px 14px',
                font: '600 13px/1 var(--font-label)',
                cursor: disabled ? 'not-allowed' : 'pointer',
                opacity: disabled ? 0.4 : 1,
                whiteSpace: 'nowrap',
                minHeight: 32,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'background 150ms var(--ease), color 150ms var(--ease)',
            }}>
            {children}
        </button>
    )
}

function TransportBtn({ size, tone = 'neutral', active, onClick, ariaLabel, disabled, children }) {
    const [hover, setHover] = useState(false)
    const hovering = hover && !disabled

    if (tone === 'record') {
        // Concentric "rec light": white shell, thick red ring, solid red core.
        // Active state fills the whole button.
        const dotSize = Math.round(size * 0.42)
        return (
            <button
                type="button"
                aria-label={ariaLabel}
                onClick={onClick}
                disabled={disabled}
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
                    cursor: disabled ? 'not-allowed' : 'pointer',
                    opacity: disabled ? 0.4 : 1,
                    flexShrink: 0,
                    transform: hovering ? 'scale(1.05)' : 'scale(1)',
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
                disabled={disabled}
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
                    cursor: disabled ? 'not-allowed' : 'pointer',
                    opacity: disabled ? 0.4 : 1,
                    flexShrink: 0,
                    transform: hovering ? 'scale(1.05)' : 'scale(1)',
                    transition: 'transform 220ms var(--ease), background 180ms var(--ease), color 180ms var(--ease)',
                }}>
                {children}
            </button>
        )
    }

    // Neutral satellite (stop / metronome) — quiet tonal circle
    const bg = hovering ? 'var(--color-surface-container)' : 'var(--color-surface-container-low)'
    const fg = active ? 'var(--color-primary)' : 'var(--color-on-surface-variant)'
    return (
        <button
            type="button"
            aria-label={ariaLabel}
            onClick={onClick}
            disabled={disabled}
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
            style={{
                width: size,
                height: size,
                borderRadius: 9999,
                background: bg,
                color: fg,
                border: 0,
                cursor: disabled ? 'not-allowed' : 'pointer',
                opacity: disabled ? 0.4 : 1,
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

// Transport cluster — lives centred in the header on desktop. Record is the same
// size as play here; it only headlines (54px) in the mobile dock.
function TransportControls({ playing, onPlay, onStop, recording, onRec, metro, onMetro }) {
    const canStop = playing || recording
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
            <TransportBtn size={30} onClick={onStop} ariaLabel="Stop" disabled={!canStop}>
                <Icon name="square" size={12} />
            </TransportBtn>
            <TransportBtn size={40} tone="play" active={playing} onClick={onPlay} ariaLabel={playing ? 'Pause' : 'Play'} disabled={recording}>
                <Icon name={playing ? 'pause' : 'play'} size={18} />
            </TransportBtn>
            <TransportBtn size={40} tone="record" active={recording} onClick={onRec} ariaLabel="Record">
                <Icon name="circle" size={16} />
            </TransportBtn>
            <TransportBtn size={30} active={metro} onClick={onMetro} ariaLabel="Metronome">
                <Icon name="audio-lines" size={12} />
            </TransportBtn>
        </div>
    )
}

// --- Notation glyphs for the tool dock ---
// The production dock draws these from the Bravura SMuFL font; the kit approximates
// the same silhouettes with plain SVG so durations read as note icons, not text.

function DurationIcon({ dur }) {
    const hollow = dur === 'w' || dur === 'h'
    const hasStem = dur !== 'w'
    const flags = dur === '8' ? 1 : dur === '16' ? 2 : 0
    const cx = 7
    const cy = 25
    const stemX = 12.4
    const stemTop = 4
    return (
        <svg width={11} height={20} viewBox="0 0 16 30" aria-hidden="true">
            {hasStem && <line x1={stemX} y1={cy - 1} x2={stemX} y2={stemTop} stroke="currentColor" strokeWidth={1.4} />}
            {Array.from({ length: flags }).map((_, i) => (
                <path
                    key={i}
                    d={`M${stemX} ${stemTop + i * 5} c4 2 5.5 4.5 3.5 9 c1 -4 -0.5 -6.5 -3.5 -7.5 Z`}
                    fill="currentColor"
                />
            ))}
            <ellipse
                cx={cx}
                cy={cy}
                rx={5.6}
                ry={4}
                transform={`rotate(-18 ${cx} ${cy})`}
                fill={hollow ? 'none' : 'currentColor'}
                stroke="currentColor"
                strokeWidth={hollow ? 1.7 : 0}
            />
        </svg>
    )
}

function TupletIcon() {
    // Bracket with a centred 3 — matches the app's tuplet chip.
    return (
        <svg width={18} height={11} viewBox="0 0 32 20" aria-hidden="true">
            <rect x={1} y={10} width={1.5} height={5} fill="currentColor" />
            <rect x={1} y={10} width={9} height={1.5} fill="currentColor" />
            <rect x={22} y={10} width={9} height={1.5} fill="currentColor" />
            <rect x={29.5} y={10} width={1.5} height={5} fill="currentColor" />
            <text x={16} y={16} textAnchor="middle" fontFamily="var(--font-serif)" fontWeight="700" fontSize={13} fill="currentColor">
                3
            </text>
        </svg>
    )
}

function RestIcon() {
    // Simplified quarter-rest squiggle.
    return (
        <svg width={9} height={16} viewBox="0 0 16 30" aria-hidden="true">
            <path
                d="M5 3 L11 11 C7 14 6.5 17 10.5 21 C5.5 19.5 4.5 16 8 12.5 L3.5 7 Z M10.5 21 C6 22.5 5.5 25 8.5 28 C3.5 26.5 3 22.5 7.5 20.5 Z"
                fill="currentColor"
            />
        </svg>
    )
}

// Upward glass popover shared by the dock's clef / key / tempo controls.
// Production positions these `bottom-[calc(100%+0.75rem)] right-0` so they can
// never hang over the dock; on mobile they become full-width sheets instead.
function DockPopover({ ariaLabel, onDismiss, width = 280, children }) {
    const popRef = React.useRef(null)
    React.useEffect(() => {
        const onKey = (e) => {
            if (e.key === 'Escape') onDismiss()
        }
        const onClick = (e) => {
            if (popRef.current && !popRef.current.contains(e.target)) onDismiss()
        }
        window.addEventListener('keydown', onKey)
        // Defer so the opening click doesn't immediately close it
        const t = setTimeout(() => document.addEventListener('mousedown', onClick), 0)
        return () => {
            clearTimeout(t)
            window.removeEventListener('keydown', onKey)
            document.removeEventListener('mousedown', onClick)
        }
    }, [])
    return (
        <div
            ref={popRef}
            role="dialog"
            aria-label={ariaLabel}
            className="glass-panel"
            style={{
                position: 'absolute',
                bottom: 'calc(100% + 12px)',
                right: 0,
                borderRadius: 12,
                padding: 16,
                width,
                zIndex: 50,
                boxShadow: 'var(--shadow-tonal)',
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
            }}>
            {children}
        </div>
    )
}

// Tempo popover — tap-along pad + manual input. Spacebar works while open.
// Opens upward from the dock; Set is a plain PrimaryButton (no pop — the
// signature lift is reserved for hero moments, not a utility commit).
function TempoPopover({ bpm, onChange, onClose }) {
    const [taps, setTaps] = useState([]) // timestamps of recent taps
    const [draft, setDraft] = useState(String(bpm))
    const [pulse, setPulse] = useState(0) // bumps each tap to flash the pad
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
            return last && now - last > 2000 ? [now] : [...prev, now].slice(-8)
        })
        setPulse((p) => p + 1)
    }, [])

    // Spacebar while popover open = tap
    React.useEffect(() => {
        const onKey = (e) => {
            if (e.code === 'Space' && document.activeElement !== inputRef.current) {
                e.preventDefault()
                handleTap()
            } else if (e.key === 'Enter' && document.activeElement === inputRef.current) {
                commit()
            }
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [handleTap])

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
        <DockPopover ariaLabel="Set tempo" onDismiss={onClose} width={360}>
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
                <span style={{ font: '500 15px/1.3 var(--font-body)' }}>Click or tap the spacebar in tempo</span>
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
                <PrimaryButton onClick={commit}>Set</PrimaryButton>
            </div>
        </DockPopover>
    )
}

// Clef + key options. Production renders SMuFL glyphs; the serif Unicode glyphs
// here are close enough for a kit chip.
const CLEF_OPTIONS = [
    ['treble', '𝄞', 'Treble'],
    ['bass', '𝄢', 'Bass'],
    ['alto', '𝄡', 'Alto'],
]

const KEY_OPTIONS = [
    [3, '3♯', 'A major'],
    [2, '2♯', 'D major'],
    [1, '1♯', 'G major'],
    [0, '♮', 'C major'],
    [-1, '1♭', 'F major'],
    [-2, '2♭', 'B♭ major'],
    [-3, '3♭', 'E♭ major'],
]

function PopoverOption({ active, onClick, glyph, label, serifGlyph }) {
    const [hover, setHover] = useState(false)
    return (
        <button
            type="button"
            onClick={onClick}
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
            aria-label={`Set ${label}`}
            style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                width: '100%',
                border: 0,
                borderRadius: 8,
                padding: '9px 12px',
                cursor: 'pointer',
                background: active
                    ? 'var(--color-primary-container)'
                    : hover
                      ? 'var(--color-surface-container)'
                      : 'var(--color-surface-container-low)',
                color: active ? 'var(--color-on-primary-container)' : 'var(--color-on-surface)',
                font: '600 13px/1 var(--font-label)',
                transition: 'background 150ms var(--ease), color 150ms var(--ease)',
            }}>
            <span>{label}</span>
            <span style={serifGlyph ? { fontFamily: 'var(--font-serif)', fontSize: 20, lineHeight: 1 } : undefined}>{glyph}</span>
        </button>
    )
}

function ClefControl({ clef, onSet }) {
    const [open, setOpen] = useState(false)
    const current = CLEF_OPTIONS.find(([k]) => k === clef) ?? CLEF_OPTIONS[0]
    return (
        <div style={{ position: 'relative' }}>
            <ChipToggle active={open} onClick={() => setOpen((o) => !o)} ariaLabel={`Clef: ${current[2]}`}>
                <span style={{ fontFamily: 'var(--font-serif)', fontSize: 19, lineHeight: 1 }}>{current[1]}</span>
            </ChipToggle>
            {open && (
                <DockPopover ariaLabel="Select clef" onDismiss={() => setOpen(false)} width={220}>
                    <Eyebrow>Clef</Eyebrow>
                    <div role="group" aria-label="Clef" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {CLEF_OPTIONS.map(([k, glyph, label]) => (
                            <PopoverOption
                                key={k}
                                active={clef === k}
                                glyph={glyph}
                                label={label}
                                serifGlyph
                                onClick={() => {
                                    onSet(k)
                                    setOpen(false)
                                }}
                            />
                        ))}
                    </div>
                </DockPopover>
            )}
        </div>
    )
}

function KeySignatureControl({ fifths, onSet }) {
    const [open, setOpen] = useState(false)
    const current = KEY_OPTIONS.find(([v]) => v === fifths) ?? KEY_OPTIONS[3]
    return (
        <div style={{ position: 'relative' }}>
            <ChipToggle active={open} onClick={() => setOpen((o) => !o)} ariaLabel={`Key signature: ${current[2]}`}>
                {current[1]}
            </ChipToggle>
            {open && (
                <DockPopover ariaLabel="Select key signature" onDismiss={() => setOpen(false)} width={240}>
                    <Eyebrow>Key signature</Eyebrow>
                    <div role="group" aria-label="Key signature" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {KEY_OPTIONS.map(([v, glyph, label]) => (
                            <PopoverOption
                                key={v}
                                active={fifths === v}
                                glyph={glyph}
                                label={label}
                                onClick={() => {
                                    onSet(v)
                                    setOpen(false)
                                }}
                            />
                        ))}
                    </div>
                </DockPopover>
            )}
        </div>
    )
}

function TempoControl({ bpm, onSet }) {
    const [open, setOpen] = useState(false)
    return (
        <div style={{ position: 'relative' }}>
            <ChipToggle active={open} onClick={() => setOpen((o) => !o)} ariaLabel={`Tempo: ${bpm} bpm`}>
                {bpm} bpm
            </ChipToggle>
            {open && <TempoPopover bpm={bpm} onChange={onSet} onClose={() => setOpen(false)} />}
        </div>
    )
}

// Export menu — replaces the old Save/Share pair; production autosaves silently,
// so the only document action left in the header is getting the score out.
const EXPORT_FORMATS = [
    ['MusicXML', 'For other notation apps (.musicxml)'],
    ['PDF', 'Print-ready sheet music (.pdf)'],
    ['MIDI', 'For DAWs and players (.mid)'],
]

function ExportMenu() {
    const [open, setOpen] = useState(false)
    const popRef = React.useRef(null)
    React.useEffect(() => {
        if (!open) return
        const onClick = (e) => {
            if (popRef.current && !popRef.current.contains(e.target)) setOpen(false)
        }
        const t = setTimeout(() => document.addEventListener('mousedown', onClick), 0)
        return () => {
            clearTimeout(t)
            document.removeEventListener('mousedown', onClick)
        }
    }, [open])
    return (
        <div ref={popRef} style={{ position: 'relative', flexShrink: 0 }}>
            <ChipToggle active={open} onClick={() => setOpen((o) => !o)} ariaLabel="Export score">
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <Icon name="download" size={14} />
                    Export
                </span>
            </ChipToggle>
            {open && (
                <div
                    role="dialog"
                    aria-label="Export score"
                    className="glass-panel"
                    style={{
                        position: 'absolute',
                        top: 'calc(100% + 8px)',
                        right: 0,
                        borderRadius: 12,
                        padding: 16,
                        zIndex: 50,
                        boxShadow: 'var(--shadow-tonal)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 8,
                    }}>
                    <Eyebrow>Export as</Eyebrow>
                    <div role="group" aria-label="Export format" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {EXPORT_FORMATS.map(([label, description]) => (
                            <ExportOption key={label} label={label} description={description} onClick={() => setOpen(false)} />
                        ))}
                    </div>
                </div>
            )}
        </div>
    )
}

function ExportOption({ label, description, onClick }) {
    const [hover, setHover] = useState(false)
    return (
        <button
            type="button"
            onClick={onClick}
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
            style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                gap: 4,
                width: 224,
                border: 0,
                borderRadius: 8,
                padding: '10px 12px',
                textAlign: 'left',
                cursor: 'pointer',
                background: hover ? 'var(--color-surface-container)' : 'var(--color-surface-container-low)',
                transition: 'background 150ms var(--ease)',
            }}>
            <span style={{ font: '600 13px/1 var(--font-label)', color: 'var(--color-on-surface)' }}>{label}</span>
            <span style={{ font: '400 11px/1 var(--font-body)', color: 'var(--color-on-surface-variant)' }}>{description}</span>
        </button>
    )
}

// --- Note tool dock ---
// The chrome mirror of the slim header: every selection-scoped edit control in one
// docked bar along the editor's bottom edge, so it can never hang over the score.
// Groups are separated by 24px of space — no dividers — and wrap onto extra rows.
function NoteToolDock({
    duration,
    onDuration,
    accidental,
    onAccidental,
    dotted,
    onDot,
    tuplet,
    onTuplet,
    rest,
    onRest,
    tied,
    onTie,
    clef,
    onClef,
    keyFifths,
    onKey,
    bpm,
    onBpm,
}) {
    return (
        <div style={{ ...CHROME_SURFACE, flexShrink: 0, zIndex: 20, padding: '10px 16px' }}>
            <div
                role="group"
                aria-label="Note tools"
                style={{
                    margin: '0 auto',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexWrap: 'wrap',
                    columnGap: 24,
                    rowGap: 8,
                }}>
                <Segmented
                    ariaLabel="Note duration"
                    value={duration}
                    onChange={onDuration}
                    options={[
                        ['w', <DurationIcon dur="w" />],
                        ['h', <DurationIcon dur="h" />],
                        ['q', <DurationIcon dur="q" />],
                        ['8', <DurationIcon dur="8" />],
                        ['16', <DurationIcon dur="16" />],
                    ]}
                />
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <ChipToggle active={dotted} onClick={onDot} ariaLabel="Dotted">
                        ·
                    </ChipToggle>
                    <ChipToggle active={tuplet} onClick={onTuplet} ariaLabel="Triplet">
                        <TupletIcon />
                    </ChipToggle>
                    <ChipToggle active={rest} onClick={onRest} ariaLabel="Rest">
                        <RestIcon />
                    </ChipToggle>
                    <ChipToggle active={tied} onClick={onTie}>
                        Tie
                    </ChipToggle>
                </div>
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
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <ClefControl clef={clef} onSet={onClef} />
                    <KeySignatureControl fifths={keyFifths} onSet={onKey} />
                    <TempoControl bpm={bpm} onSet={onBpm} />
                </div>
            </div>
        </div>
    )
}

// Format seconds: S"s" under a minute, M:SS under an hour, then H"h".
function fmtRecTime(sec) {
    const s = Math.max(0, Math.floor(sec))
    if (s < 60) return `${s}s`
    const m = Math.floor(s / 60)
    if (m < 60) return `${m}:${String(s % 60).padStart(2, '0')}`
    const h = Math.floor(m / 60)
    return m % 60 ? `${h}h ${m % 60}m` : `${h}h`
}

// Limit-reached dialog. Tier-aware: every capped tier sees an upgrade CTA; the
// secondary action acknowledges the cap ("OK, I'll wait"). Minute packs offer a
// one-time escape hatch without a subscription change.
function LimitReachedDialog({ planName, nextPlanName, limitSec, onUpgrade, onClose }) {
    return (
        <DialogScrim onDismiss={onClose}>
            <DialogPanel
                title={`You've used today's ${fmtRecTime(limitSec)} of recording.`}
                subtitle={`Your ${planName} plan resets at midnight. Until then, playback, editing, and export still work — only mic capture pauses.`}
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
                            immediately.
                        </span>
                    )}
                    <span style={{ font: '400 12px/1.5 var(--font-body)', color: 'var(--color-on-surface-variant)' }}>
                        Just need to finish this one?{' '}
                        <span style={{ color: 'var(--color-primary)', textDecoration: 'underline', cursor: 'pointer' }}>
                            One-time minute packs
                        </span>{' '}
                        start at $6 and never expire.
                    </span>
                </div>
            </DialogPanel>
        </DialogScrim>
    )
}

// Concurrent-recording dialog. Shown when the account already has a recording
// in flight (another tab or device) — one recording at a time is a hard rule.
// Single acknowledgment action; nothing in the current score is touched.
function ConcurrentRecordingDialog({ onClose }) {
    return (
        <DialogScrim onDismiss={onClose}>
            <DialogPanel
                title="One recording at a time."
                subtitle="Your account already has a recording running — maybe in another tab, or on another device."
                onClose={onClose}
                width={480}
                footer={<PrimaryButton onClick={onClose}>Got it</PrimaryButton>}>
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
                            <Icon name="mic" size={20} />
                        </span>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                            <span style={{ font: '600 14px/1.3 var(--font-body)', color: 'var(--color-on-surface)' }}>
                                The mic is busy somewhere else
                            </span>
                            <span style={{ font: '400 12px/1.4 var(--font-body)', color: 'var(--color-on-surface-variant)' }}>
                                Finish or stop that session first, then hit record here. Nothing in this score was changed.
                            </span>
                        </div>
                    </div>
                </div>
            </DialogPanel>
        </DialogScrim>
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

// Add/remove-measure controls — small icon buttons sitting in the score area at
// the end of the last staff (production draws them inside the score SVG itself).
function MeasureButtons({ onAdd, onRemove }) {
    return (
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '4px 8px 0 0' }}>
            <IconButton icon="plus" size={28} ariaLabel="Add measure" onClick={onAdd} idleBg="var(--color-surface-container-low)" />
            <IconButton
                icon="minus"
                size={28}
                ariaLabel="Remove last measure"
                onClick={onRemove}
                idleBg="var(--color-surface-container-low)"
            />
        </div>
    )
}

// Tier metadata duplicated here so Editor doesn't reach across modules. In
// production the tiers live in the database (GET /plans); lib/plans.ts holds the
// display decoration. Every tier is capped — there is no unlimited recording.
const EDITOR_TIERS = {
    free: { name: 'Sketch', dailyLimitSec: 180, next: 'Songwriter' },
    pro: { name: 'Songwriter', dailyLimitSec: 1200, next: 'Studio' },
    studio: { name: 'Studio', dailyLimitSec: 10800, next: 'Arranger' },
    arranger: { name: 'Arranger', dailyLimitSec: 28800, next: null },
}

const KIT_INSTRUMENTS = ['Piano', 'Violin', 'Flute', 'Guitar']

function Editor({ score, onBack, onSettings, planId = 'free', recUsedSec = 0, onRecUsedSecChange, onUpgrade }) {
    const [duration, setDuration] = useState('q')
    const [accidental, setAccidental] = useState('')
    const [dotted, setDotted] = useState(false)
    const [tuplet, setTuplet] = useState(false)
    const [rest, setRest] = useState(false)
    const [tied, setTied] = useState(false)
    const [clef, setClef] = useState('treble')
    const [keyFifths, setKeyFifths] = useState(0)
    const [playing, setPlaying] = useState(false)
    const [recording, setRecording] = useState(false)
    const [metro, setMetro] = useState(false)
    const [bpm, setBpm] = useState(120)
    const [title, setTitle] = useState(score?.title ?? 'Untitled composition')
    const [instrument, setInstrument] = useState(score?.instrument ?? 'Piano')
    const [instrumentHover, setInstrumentHover] = useState(false)
    const [shortcutsOn, setShortcutsOn] = useState(false)
    const [limitDialogOpen, setLimitDialogOpen] = useState(false)
    const [concurrentDialogOpen, setConcurrentDialogOpen] = useState(false)

    const tier = EDITOR_TIERS[planId] ?? EDITOR_TIERS.free
    const limitSec = tier.dailyLimitSec
    const exhausted = recUsedSec >= limitSec

    // Tick today's recording usage while the record button is active. When the
    // daily cap is reached, stop the recorder and open the dialog — the same
    // dialog opens when the user taps Record on an exhausted limit. (There is no
    // in-editor usage meter; the limit only surfaces through this dialog.)
    React.useEffect(() => {
        if (!recording) return
        if (exhausted) {
            setRecording(false)
            setLimitDialogOpen(true)
            return
        }
        const id = setInterval(() => {
            onRecUsedSecChange?.((prev) => (prev ?? 0) + 0.1)
        }, 100)
        return () => clearInterval(id)
    }, [recording, exhausted])

    // Shift-click simulates the gateway refusing the take because another
    // session on the account is already recording (other tab / other device).
    const handleRecClick = (e) => {
        if (e?.shiftKey) {
            setConcurrentDialogOpen(true)
            return
        }
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
            {/* Slim header — back · wordmark · title · instrument | transport | shortcuts · export */}
            <header
                style={{
                    ...CHROME_SURFACE,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 16,
                    padding: '8px 20px',
                    zIndex: 10,
                }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
                    <button
                        onClick={onBack}
                        aria-label="Back to library"
                        style={{
                            background: 'transparent',
                            border: 0,
                            cursor: 'pointer',
                            color: 'var(--color-on-surface-variant)',
                            padding: 6,
                            marginLeft: -6,
                            borderRadius: 9999,
                            display: 'inline-flex',
                        }}>
                        <Icon name="arrow-left" size={20} />
                    </button>
                    <Wordmark size={19} />
                    <div
                        style={{
                            width: 1,
                            height: 20,
                            background: 'color-mix(in srgb, var(--color-outline-variant) 15%, transparent)',
                        }}
                    />
                    <input
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        aria-label="Score title"
                        style={{
                            background: 'transparent',
                            border: 0,
                            outline: 0,
                            fontFamily: 'var(--font-display)',
                            fontWeight: 500,
                            fontSize: 17,
                            letterSpacing: '-0.01em',
                            color: 'var(--color-on-surface)',
                            padding: '6px 8px',
                            borderRadius: 4,
                            minWidth: 64,
                            maxWidth: '40%',
                            flexShrink: 1,
                        }}
                    />
                    {/* Instrument chip — interactive: opens the change-instrument dialog in
                        production; the kit just cycles instruments to feel alive. */}
                    <button
                        type="button"
                        onClick={() => setInstrument(KIT_INSTRUMENTS[(KIT_INSTRUMENTS.indexOf(instrument) + 1) % KIT_INSTRUMENTS.length])}
                        onMouseEnter={() => setInstrumentHover(true)}
                        onMouseLeave={() => setInstrumentHover(false)}
                        aria-label={`Change instrument (current: ${instrument})`}
                        style={{
                            flexShrink: 0,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            border: 0,
                            borderRadius: 9999,
                            padding: '6px 10px',
                            cursor: 'pointer',
                            font: '600 11px/1 var(--font-label)',
                            whiteSpace: 'nowrap',
                            background: instrumentHover
                                ? 'var(--color-secondary-soft)'
                                : 'color-mix(in srgb, var(--color-secondary-soft) 70%, transparent)',
                            color: 'var(--color-on-secondary-soft)',
                            transition: 'background 150ms var(--ease)',
                        }}>
                        {instrument}
                        <Icon name="sliders-horizontal" size={11} />
                    </button>
                </div>

                {/* Transport — centred; moves into the dock on mobile */}
                <TransportControls
                    playing={playing}
                    onPlay={() => setPlaying((p) => !p)}
                    onStop={() => {
                        setPlaying(false)
                        setRecording(false)
                    }}
                    recording={recording}
                    onRec={handleRecClick}
                    metro={metro}
                    onMetro={() => setMetro((m) => !m)}
                />

                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, flex: 1, justifyContent: 'flex-end' }}>
                    <ChipToggle active={shortcutsOn} onClick={() => setShortcutsOn((o) => !o)} ariaLabel="Keyboard shortcuts">
                        <Icon name="keyboard" size={16} />
                    </ChipToggle>
                    <ExportMenu />
                </div>
            </header>

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
            {concurrentDialogOpen && <ConcurrentRecordingDialog onClose={() => setConcurrentDialogOpen(false)} />}

            {/* Sanctuary canvas */}
            <div style={{ flex: 1, overflow: 'auto', padding: '0 32px', display: 'flex', flexDirection: 'column' }}>
                <div
                    style={{
                        maxWidth: 960,
                        width: '100%',
                        margin: '0 auto',
                        flex: 1,
                        background: 'var(--color-surface-container-lowest)',
                        padding: 40,
                        boxShadow: 'var(--shadow-tonal)',
                    }}>
                    <PlaceholderStaff />
                    <PlaceholderStaff />
                    <MeasureButtons onAdd={() => {}} onRemove={() => {}} />
                </div>
            </div>

            {/* Bottom tool dock */}
            <NoteToolDock
                duration={duration}
                onDuration={setDuration}
                accidental={accidental}
                onAccidental={setAccidental}
                dotted={dotted}
                onDot={() => setDotted(!dotted)}
                tuplet={tuplet}
                onTuplet={() => setTuplet(!tuplet)}
                rest={rest}
                onRest={() => setRest(!rest)}
                tied={tied}
                onTie={() => setTied(!tied)}
                clef={clef}
                onClef={setClef}
                keyFifths={keyFifths}
                onKey={setKeyFifths}
                bpm={bpm}
                onBpm={setBpm}
            />
        </div>
    )
}

Object.assign(window, { Editor })
