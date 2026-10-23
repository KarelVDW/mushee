// Score editor — slim header + sanctuary canvas + bottom-docked note tool bar.
//
// Chrome grammar (mirrors apps/web/src/app/scores/[id]):
//   header (slim, py-2) → back · wordmark · title · instrument chip
//                          | transport centred: [stop 36, only while playing/recording]
//                            [play 40] [● record 48 — the largest] [metronome 36]
//                          | keyboard-shortcuts chip · Export menu
//   dock (bottom, in-flow) → every selection-scoped edit control in one bar along the
//                            editor's bottom edge, left to right: Pitch (Higher · Lower) ·
//                            Length (durations as SVG note icons + Dotted) · ♭ ♮ ♯ · Rest ·
//                            More (Triplet, Tie, Simplify sharps and flats) · clef/key/tempo.
//                            Each group sits in a white capsule well (surface-container-lowest
//                            + tonal glow); the wells are separated by space — no dividers —
//                            and wrap onto extra rows. Controls inside a well are transparent
//                            at rest; standalone chrome controls carry the white fill
//                            themselves. Popovers open UPWARD, away from the dock, on the
//                            opaque card (never glass) with the overlay shadow.
//   Both chrome surfaces are the same tonal mirror: surface-container-low @ 85% +
//   backdrop blur + tonal shadow. Saving is autosave with a quiet status — no Save button.
//
// Not depicted in this kit (see ../../DESIGN.md §4 and §4b): the save status, Share /
// Recordings chips, tooltips, the dock's hint line, the recording strip that replaces
// the tool wells during a take, the editor empty state, and the phone layout (a tool row
// — Undo · lengths · More — over the action row: Note ◀ ▶, Pitch ▼ ▲, stop 40 / play 46 /
// record 56, with everything else in the "More tools" sheet).

// Chrome mirror surface — shared by the header and the dock.
const CHROME_SURFACE = {
    background: 'color-mix(in srgb, var(--color-surface-container-low) 85%, transparent)',
    backdropFilter: 'blur(24px)',
    WebkitBackdropFilter: 'blur(24px)',
    boxShadow: 'var(--shadow-tonal)',
}

// White capsule "well" (surface_container_lowest + tonal glow — the card lift).
// It's the tonal shift, not a border, that says "buttons live here" and marks
// where one group ends. Controls inside a well render `plain` (transparent at
// rest); the well provides the raised surface. Mirrors ToolGroup in
// apps/web/src/components/ui/Controls.tsx.
function ToolGroup({ ariaLabel, children }) {
    return (
        <div
            role="group"
            aria-label={ariaLabel}
            style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 2,
                padding: 3,
                borderRadius: 9999,
                background: 'var(--color-surface-container-lowest)',
                boxShadow: 'var(--shadow-tonal)',
            }}>
            {children}
        </div>
    )
}

// Segmented pill track — itself a capsule well: white fill + tonal glow, options
// transparent at rest and hovering *away* from the page (surface_container_high),
// active option in loud cyan. `bare` drops the track when the Segmented shares a
// ToolGroup well with other controls (Length + Dotted).
function Segmented({ value, onChange, options, ariaLabel, bare }) {
    const [hovered, setHovered] = useState(null)
    return (
        <div
            role="group"
            aria-label={ariaLabel}
            style={{
                display: 'inline-flex',
                gap: 2,
                padding: bare ? 0 : 3,
                borderRadius: 9999,
                background: bare ? 'transparent' : 'var(--color-surface-container-lowest)',
                boxShadow: bare ? 'none' : 'var(--shadow-tonal)',
            }}>
            {options.map(([k, g]) => {
                const active = value === k
                const hovering = hovered === k && !active
                return (
                    <button
                        key={k || 'default'}
                        aria-pressed={active}
                        onClick={() => onChange(k)}
                        onMouseEnter={() => setHovered(k)}
                        onMouseLeave={() => setHovered((h) => (h === k ? null : h))}
                        style={{
                            background: active
                                ? 'var(--color-primary-container)'
                                : hovering
                                  ? 'var(--color-surface-container-high)'
                                  : 'transparent',
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

// `plain` chips (transparent at rest) live inside a ToolGroup/Segmented well,
// which supplies the white lift. Standalone chips (header keyboard-shortcuts,
// Export trigger) carry the white fill + tonal glow themselves. Both hover
// *away* from the page tone, to surface_container_high.
function ChipToggle({ active, onClick, children, ariaLabel, disabled, plain }) {
    const [hover, setHover] = useState(false)
    const hovering = hover && !disabled
    let background = 'transparent'
    if (active) background = 'var(--color-primary-container)'
    else if (hovering) background = 'var(--color-surface-container-high)'
    else if (!plain) background = 'var(--color-surface-container-lowest)'
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
                background,
                boxShadow: !active && !plain ? 'var(--shadow-tonal)' : 'none',
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
        // The only ringed transport control: a white shell in a 3px record-red ring
        // round a flat record-red dot. Live, the whole button fills record red and the
        // core becomes a white stop square — while a take runs, Record is the stop
        // ("Stop recording"). One red, --color-record (#ef4444), never the error tones.
        const dotSize = Math.round(size * (active ? 0.36 : 0.42))
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
                    background: active ? 'var(--color-record)' : 'var(--color-surface-container-lowest)',
                    border: '3px solid var(--color-record)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: disabled ? 'not-allowed' : 'pointer',
                    opacity: disabled ? 0.4 : 1,
                    flexShrink: 0,
                    transform: hovering ? 'scale(1.05)' : 'scale(1)',
                    transition: 'transform 200ms var(--ease), background 200ms var(--ease), border-color 200ms var(--ease)',
                }}>
                <span
                    style={{
                        width: dotSize,
                        height: dotSize,
                        borderRadius: active ? '22%' : 9999,
                        background: active ? 'var(--color-on-record)' : 'var(--color-record)',
                        transition: 'background 200ms var(--ease)',
                    }}
                />
            </button>
        )
    }

    if (tone === 'play') {
        // A white circle with the raised glow and a primary glyph — no ring, so it never
        // competes with Record's — that fills primary-container while playing.
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
                    boxShadow: active ? 'none' : 'var(--shadow-raised)',
                    border: 0,
                    color: active ? 'var(--color-on-primary-container)' : 'var(--color-primary)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: disabled ? 'not-allowed' : 'pointer',
                    opacity: disabled ? 0.4 : 1,
                    flexShrink: 0,
                    transform: hovering ? 'scale(1.05)' : 'scale(1)',
                    transition: 'transform 200ms var(--ease), background 200ms var(--ease), color 200ms var(--ease)',
                }}>
                {children}
            </button>
        )
    }

    // Neutral satellite (stop / metronome) — a standalone white circle on the
    // chrome (surface_container_lowest), hovering away to surface_container_high.
    // A pressed toggle (the metronome) shows its on state as the loud cyan fill.
    const bg = active
        ? 'var(--color-primary-container)'
        : hovering
          ? 'var(--color-surface-container-high)'
          : 'var(--color-surface-container-lowest)'
    const fg = active ? 'var(--color-on-primary-container)' : 'var(--color-on-surface-variant)'
    return (
        <button
            type="button"
            aria-label={ariaLabel}
            aria-pressed={active}
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

// Transport cluster — lives centred in the header on desktop. Record is the largest
// control here too (48px vs 40px play; 54px in the mobile dock). Stop keeps its slot
// but shows only while playback runs; while a recording runs, Record is the one stop
// (with Space and Escape) — never a second stop square beside it. The metronome wears
// its own glyph (audio-lines means recorded audio).
function TransportControls({ playing, onPlay, onStop, recording, onRec, metro, onMetro }) {
    const canStop = playing
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
            <span style={{ display: 'inline-flex', visibility: canStop ? 'visible' : 'hidden' }}>
                <TransportBtn size={36} onClick={onStop} ariaLabel="Stop" disabled={!canStop}>
                    <Icon name="square" size={14} />
                </TransportBtn>
            </span>
            <TransportBtn size={40} tone="play" active={playing} onClick={onPlay} ariaLabel={playing ? 'Pause' : 'Play'} disabled={recording}>
                <Icon name={playing ? 'pause' : 'play'} size={18} />
            </TransportBtn>
            <TransportBtn size={48} tone="record" active={recording} onClick={onRec} ariaLabel={recording ? 'Stop recording' : 'Record'}>
                <Icon name="circle" size={16} />
            </TransportBtn>
            <TransportBtn size={36} active={metro} onClick={onMetro} ariaLabel="Metronome">
                <Icon name="metronome" size={16} />
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

// Upward popover shared by the dock's clef / key / tempo / More controls — on the
// opaque card (surface-container-lowest + overlay shadow), never glass: blur
// doesn't nest inside the dock's own backdrop blur. Production positions these
// `bottom-[calc(100%+0.75rem)] right-0` so they can never hang over the dock; on
// mobile they become sheets instead.
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
            style={{
                position: 'absolute',
                bottom: 'calc(100% + 12px)',
                right: 0,
                borderRadius: 12,
                padding: 16,
                width,
                zIndex: 50,
                background: 'var(--color-surface-container-lowest)',
                boxShadow: 'var(--shadow-overlay)',
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
                    {taps.length < 2 ? 'Tap at least twice' : `${tappedBpm} bpm from ${taps.length} taps`}
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
                <span style={{ font: '500 15px/1.3 var(--font-body)' }}>Click here or press the spacebar on every beat</span>
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
                        aria-label="Tempo (bpm)"
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
                <PrimaryButton onClick={commit}>Set tempo</PrimaryButton>
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
    [0, '', 'C major'],
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
            <ChipToggle plain active={open} onClick={() => setOpen((o) => !o)} ariaLabel={`Clef: ${current[2]}`}>
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
            <ChipToggle plain active={open} onClick={() => setOpen((o) => !o)} ariaLabel={`Key: ${current[2]}`}>
                {current[2]}
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
            <ChipToggle plain active={open} onClick={() => setOpen((o) => !o)} ariaLabel={`Tempo: ${bpm} bpm`}>
                {bpm} bpm
            </ChipToggle>
            {open && <TempoPopover bpm={bpm} onChange={onSet} onClose={() => setOpen(false)} />}
        </div>
    )
}

// Export menu — replaces the old Save/Share pair; production autosaves silently,
// so the only document action left in the header is getting the score out.
const EXPORT_FORMATS = [
    ['PDF', 'Print it or send it as sheet music (.pdf)'],
    ['MIDI', 'Open it in GarageBand or other music apps (.mid)'],
    ['MusicXML', 'Keep editing in MuseScore or other notation apps (.musicxml)'],
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
                    style={{
                        position: 'absolute',
                        top: 'calc(100% + 8px)',
                        right: 0,
                        borderRadius: 12,
                        padding: 16,
                        zIndex: 50,
                        background: 'var(--color-surface-container-lowest)',
                        boxShadow: 'var(--shadow-overlay)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 8,
                    }}>
                    <Eyebrow>Download as</Eyebrow>
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
            <span style={{ font: '400 11px/1.3 var(--font-body)', color: 'var(--color-on-surface-variant)' }}>{description}</span>
        </button>
    )
}

// --- Note tool dock ---
// The chrome mirror of the slim header: every selection-scoped edit control in one
// docked bar along the editor's bottom edge, so it can never hang over the score.
// Each tool group sits in its own white capsule well (ToolGroup / the Segmented
// track) — the tonal lift is what separates one group from the next, so groups
// need only 24px of space between them, no dividers. Groups wrap onto extra rows.
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
    onHigher = () => {},
    onLower = () => {},
}) {
    return (
        <div style={{ ...CHROME_SURFACE, flexShrink: 0, zIndex: 20, padding: '10px 16px' }}>
            <div
                style={{
                    margin: '0 auto',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexWrap: 'wrap',
                    columnGap: 24,
                    rowGap: 8,
                }}>
                <ToolGroup ariaLabel="Pitch">
                    <ChipToggle plain onClick={onHigher} ariaLabel="Higher">
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            <Icon name="chevron-up" size={12} />
                            Higher
                        </span>
                    </ChipToggle>
                    <ChipToggle plain onClick={onLower} ariaLabel="Lower">
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            <Icon name="chevron-down" size={12} />
                            Lower
                        </span>
                    </ChipToggle>
                </ToolGroup>
                <ToolGroup ariaLabel="Length">
                    <Segmented
                        bare
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
                    <ChipToggle plain active={dotted} onClick={onDot} ariaLabel="Dotted">
                        <DottedIcon />
                    </ChipToggle>
                </ToolGroup>
                <Segmented
                    ariaLabel="Sharp or flat"
                    value={accidental}
                    onChange={onAccidental}
                    options={[
                        ['b', '♭'],
                        ['', '♮'],
                        ['#', '♯'],
                    ]}
                />
                <ChipToggle active={rest} onClick={onRest} ariaLabel="Rest">
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <RestIcon />
                        Rest
                    </span>
                </ChipToggle>
                <MoreNoteTools tuplet={tuplet} onTuplet={onTuplet} tied={tied} onTie={onTie} />
                <ToolGroup ariaLabel="Score settings">
                    <ClefControl clef={clef} onSet={onClef} />
                    <KeySignatureControl fifths={keyFifths} onSet={onKey} />
                    <TempoControl bpm={bpm} onSet={onBpm} />
                </ToolGroup>
            </div>
        </div>
    )
}

// The dotted control is a drawn glyph — a quarter note with its dot — never a "·".
function DottedIcon() {
    return (
        <span style={{ display: 'inline-flex', alignItems: 'flex-end', gap: 1 }}>
            <DurationIcon dur="q" />
            <svg width={4} height={20} viewBox="0 0 4 20" aria-hidden="true">
                <circle cx={2} cy={16} r={1.6} fill="currentColor" />
            </svg>
        </span>
    )
}

// "More" — Triplet, Tie and Simplify sharps and flats behind one labelled chip,
// opening the upward "More note tools" popover: 44px rows, each with a plain hint.
function MoreNoteTools({ tuplet, onTuplet, tied, onTie }) {
    const [open, setOpen] = useState(false)
    const rows = [
        { label: 'Triplet', hint: 'Three notes in the time of two', pressed: tuplet, onClick: onTuplet },
        { label: 'Tie', hint: 'Hold into the next note of the same pitch', pressed: tied, onClick: onTie },
        { label: 'Simplify sharps and flats', hint: 'Fewest possible, same sound', onClick: () => setOpen(false) },
    ]
    return (
        <div style={{ position: 'relative' }}>
            <ChipToggle active={open} onClick={() => setOpen((o) => !o)} ariaLabel="More note tools">
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    More
                    <Icon name="chevron-up" size={12} />
                </span>
            </ChipToggle>
            {open && (
                <DockPopover ariaLabel="More note tools" onDismiss={() => setOpen(false)} width={300}>
                    <Eyebrow>More note tools</Eyebrow>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {rows.map((row) => (
                            <button
                                key={row.label}
                                type="button"
                                aria-pressed={row.pressed}
                                onClick={row.onClick}
                                style={{
                                    display: 'flex',
                                    flexDirection: 'column',
                                    alignItems: 'flex-start',
                                    justifyContent: 'center',
                                    gap: 4,
                                    minHeight: 44,
                                    border: 0,
                                    borderRadius: 8,
                                    padding: '8px 12px',
                                    textAlign: 'left',
                                    cursor: 'pointer',
                                    background: row.pressed ? 'var(--color-primary-container)' : 'var(--color-surface-container-low)',
                                    color: row.pressed ? 'var(--color-on-primary-container)' : 'var(--color-on-surface)',
                                }}>
                                <span style={{ font: '600 13px/1.2 var(--font-label)' }}>{row.label}</span>
                                <span style={{ font: '400 11px/1.3 var(--font-body)', opacity: 0.8 }}>{row.hint}</span>
                            </button>
                        ))}
                    </div>
                </DockPopover>
            )}
        </div>
    )
}

// An allowance in words, as production's formatAllowance (src/lib/recordingTime.ts)
// writes it: 180 → "3 minutes", 10800 → "3 hours". A clock readout ("0:42") is only
// ever the length of a recording, never an allowance.
function fmtAllowance(sec) {
    const s = Math.max(0, Math.floor(sec))
    const plural = (n, unit) => `${n} ${unit}${n === 1 ? '' : 's'}`
    if (s < 60) return plural(s, 'second')
    if (s < 3600 && s % 60 === 0) return plural(s / 60, 'minute')
    if (s % 3600 === 0) return plural(s / 3600, 'hour')
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    return h ? `${h} h${m ? ` ${m} min` : ''}` : `${m} min${s % 60 ? ` ${s % 60} sec` : ''}`
}

// Production's RecordingLimitCopy.NO_SURPRISES — it rides the subtitle, so the body
// only offers more.
const NO_SURPRISES = 'No surprise charges — Solkey never bills for extra minutes.'

// Daily-limit dialog. A normal moment, not an error: neutral, no callout, one flat
// button. It says what the allowance was (in words), that everything recorded is in
// the score, when recording is back (the viewer's own time, never "midnight") and
// that nothing is ever charged; then — only where there is a next tier — what that
// tier gives. It ends like the score-limit dialog: "Not now" · "See {plan}". Minute
// packs offer a one-time way to finish without a subscription change.
function LimitReachedDialog({ nextPlanName, nextLimitSec, limitSec, onUpgrade, onClose }) {
    return (
        <DialogPanel
            title={`That's your ${fmtAllowance(limitSec)} of recording for today.`}
            subtitle={`Everything you recorded is in your score. Playing, editing and exporting still work — recording is back tonight at 8:00 PM. ${NO_SURPRISES}`}
            onClose={onClose}
            width={480}
            footer={
                <>
                    <TertiaryButton onClick={onClose}>Not now</TertiaryButton>
                    {nextPlanName && (
                        <PrimaryButton icon="arrow-right" onClick={onUpgrade}>
                            See {nextPlanName}
                        </PrimaryButton>
                    )}
                </>
            }>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingBottom: 8 }}>
                {nextPlanName && (
                    <span style={{ font: '400 13px/1.5 var(--font-body)', color: 'var(--color-on-surface)' }}>
                        {nextPlanName} gives you {fmtAllowance(nextLimitSec)} every day, starting right away.
                    </span>
                )}
                <span style={{ font: '400 12px/1.5 var(--font-body)', color: 'var(--color-on-surface-variant)' }}>
                    Just need to finish this one?{' '}
                    <span style={{ color: 'var(--color-primary)', textDecoration: 'underline', cursor: 'pointer' }}>
                        Minute packs
                    </span>{' '}
                    start at $6 and never expire.
                </span>
            </div>
        </DialogPanel>
    )
}

// Concurrent-recording dialog. Shown when the account already has a recording
// in flight (another tab or device) — one recording at a time is a hard rule.
// Single acknowledgment action; nothing in the current score is touched. The
// callout is neutral (never red — this is not an error) and has no title of its
// own: the subtitle already says what is in the way (the account's one recording,
// not this device's mic), so the callout says only what to do about it.
function ConcurrentRecordingDialog({ onClose }) {
    return (
        <DialogPanel
            title="One recording at a time."
            subtitle="You're already recording somewhere else — another tab, or another device."
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
                            background: 'var(--color-surface-container)',
                            color: 'var(--color-on-surface-variant)',
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}>
                        <Icon name="mic" size={20} />
                    </span>
                    <span style={{ font: '400 13px/1.5 var(--font-body)', color: 'var(--color-on-surface)' }}>
                        Stop that recording, then press record here. Just closed it? Give it about 20 seconds and try again.
                        Nothing in this score changed.
                    </span>
                </div>
            </div>
        </DialogPanel>
    )
}

// Storyboard of the Control Center → Mic Mode → Wide Spectrum flow. Like production
// (WideSpectrumSteps in RecordingDialogs.tsx), the three steps are all visible at once,
// numbered, with no animation.
function WideSpectrumWalkthrough() {
    const phases = [
        {
            caption: 'Swipe down from the top-right corner',
            scene: (
                <div style={{ position: 'relative', width: 72, height: 88, borderRadius: 10, background: 'var(--color-surface-container-lowest)', boxShadow: 'var(--shadow-tonal)' }}>
                    <div style={{ position: 'absolute', top: 6, right: 12, height: 48, width: 2, borderRadius: 9999, background: 'color-mix(in srgb, var(--color-primary) 30%, transparent)' }} />
                    <div style={{ position: 'absolute', top: 4, right: 8, width: 14, height: 14, borderRadius: 9999, background: 'var(--color-primary)' }} />
                </div>
            ),
        },
        {
            caption: 'Tap Mic Mode',
            scene: (
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10, background: 'var(--color-surface-container-lowest)', boxShadow: 'var(--shadow-tonal)', borderRadius: 10, padding: '10px 14px' }}>
                    <span style={{ width: 30, height: 30, borderRadius: 9999, background: 'var(--color-primary-soft)', color: 'var(--color-on-primary-soft)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <Icon name="mic" size={16} />
                    </span>
                    <span style={{ font: '600 13px/1 var(--font-body)', color: 'var(--color-on-surface)' }}>Mic Mode</span>
                </div>
            ),
        },
        {
            caption: 'Choose Wide Spectrum',
            scene: (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, width: 150 }}>
                    {['Standard', 'Voice Isolation'].map((mode) => (
                        <span key={mode} style={{ font: '400 12px/1.4 var(--font-body)', color: 'var(--color-on-surface-variant)', borderRadius: 4, padding: '6px 12px' }}>
                            {mode}
                        </span>
                    ))}
                    <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--color-primary-soft)', color: 'var(--color-on-primary-soft)', borderRadius: 4, padding: '6px 12px' }}>
                        <span style={{ font: '600 12px/1.4 var(--font-body)' }}>Wide Spectrum</span>
                        <Icon name="check" size={14} />
                    </span>
                </div>
            ),
        },
    ]
    return (
        <div
            aria-hidden="true"
            style={{ display: 'flex', gap: 8, borderRadius: 10, background: 'var(--color-surface-container-low)', padding: 16 }}>
            {phases.map((phase, i) => (
                <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start', gap: 12, textAlign: 'center' }}>
                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{phase.scene}</div>
                    <span style={{ font: '400 12px/1.4 var(--font-body)', color: 'var(--color-on-surface-variant)' }}>{phase.caption}</span>
                </div>
            ))}
        </div>
    )
}

// Shown once per device the first time an iPhone user hits record: iOS voice
// processing erases whistling and instrument tones unless Control Center's Mic
// Mode is set to Wide Spectrum, and no web API can do it for them (see
// src/lib/micMode.ts, localStorage key `solkey:mic-mode-guide`). Production opens
// a warm-up mic stream *before* this dialog so the Control Center tile exists and
// the steps are performable now — which is what lets the confirm button attest the
// setting rather than a bare "OK".
function MicModeGuideDialog({ onConfirm, onClose, onSkip = onClose }) {
    return (
        <DialogPanel
            title="One quick iPhone setting"
            subtitle="iPhones tune the mic for phone calls, which can hide whistling and instruments. Switch it to Wide Spectrum once and you're set."
            onClose={onClose}
            width={480}
            footer={
                <>
                    <TertiaryButton onClick={onSkip}>Record without it</TertiaryButton>
                    <PrimaryButton icon="mic" onClick={onConfirm}>
                        Done — start recording
                    </PrimaryButton>
                </>
            }>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingBottom: 8 }}>
                <WideSpectrumWalkthrough />
                <span style={{ font: '400 13px/1.4 var(--font-body)', color: 'var(--color-on-surface-variant)' }}>
                    Your mic is on, so Mic Mode is in Control Center right now. Your iPhone remembers it.
                </span>
            </div>
        </DialogPanel>
    )
}

// Reminder toast for returning iPhone users — fired at take start (production:
// Toaster + showToast with a per-toast `icon`). Auto-dismisses; an opaque card.
function MicReminderToast({ onDone }) {
    React.useEffect(() => {
        const t = setTimeout(onDone, 5200)
        return () => clearTimeout(t)
    }, [])
    return (
        <div
            role="status"
            style={{
                background: 'var(--color-surface-container-lowest)',
                position: 'absolute',
                bottom: 96,
                left: '50%',
                transform: 'translateX(-50%)',
                zIndex: 60,
                maxWidth: 420,
                display: 'flex',
                alignItems: 'flex-start',
                gap: 12,
                padding: '10px 16px 10px 12px',
                borderRadius: 12,
                boxShadow: 'var(--shadow-overlay)',
            }}>
            <span
                style={{
                    width: 28,
                    height: 28,
                    borderRadius: 9999,
                    flexShrink: 0,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'var(--color-primary-soft)',
                    color: 'var(--color-on-primary-soft)',
                }}>
                <Icon name="mic" size={16} />
            </span>
            <span style={{ font: '400 13px/1.45 var(--font-body)', color: 'var(--color-on-surface)' }}>
                Recording on iPhone: keep Mic Mode on Wide Spectrum (Control Center) so every note comes through.
            </span>
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

// Add / remove-bar controls — HTML chrome under the last row's final barline
// (export-excluded, neutral tones, never inside the score SVG): a labelled
// "Add bar" chip and, 16px away, an icon-only "Remove last bar".
function MeasureButtons({ onAdd, onRemove }) {
    return (
        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 16, padding: '12px 8px 0 0' }}>
            <ChipToggle onClick={onAdd} ariaLabel="Add bar">
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <Icon name="plus" size={12} />
                    Add bar
                </span>
            </ChipToggle>
            <IconButton
                icon="minus"
                size={28}
                ariaLabel="Remove last bar"
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
    const [title, setTitle] = useState(score?.title ?? 'Untitled score')
    const [instrument, setInstrument] = useState(score?.instrument ?? 'Piano')
    const [instrumentHover, setInstrumentHover] = useState(false)
    const [shortcutsOn, setShortcutsOn] = useState(false)
    const [limitDialogOpen, setLimitDialogOpen] = useState(false)
    const [concurrentDialogOpen, setConcurrentDialogOpen] = useState(false)
    const [micGuideOpen, setMicGuideOpen] = useState(false)
    const [micReminderOn, setMicReminderOn] = useState(false)
    // Production gates the Mic Mode guide on an iPhone user-agent; the kit defaults
    // it on so both surfaces (first-run dialog, then the returning reminder) are
    // demoable. "Seen" persists to the same localStorage key production uses.
    const isIPhone = true
    const [micGuideSeen, setMicGuideSeen] = useState(
        () => typeof localStorage !== 'undefined' && localStorage.getItem('solkey:mic-mode-guide') === 'done',
    )

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
        // Already rolling → just stop; no mic gating on the way down.
        if (recording) {
            setRecording(false)
            return
        }
        if (exhausted) {
            setLimitDialogOpen(true)
            return
        }
        // First iPhone take on this device → guide before the mic starts.
        if (isIPhone && !micGuideSeen) {
            setMicGuideOpen(true)
            return
        }
        beginRecording()
    }

    // Starts the take. Returning iPhone users get a reminder toast at start.
    const beginRecording = () => {
        if (isIPhone && micGuideSeen) setMicReminderOn(true)
        setRecording(true)
    }

    const confirmMicGuide = () => {
        setMicGuideSeen(true)
        try {
            localStorage.setItem('solkey:mic-mode-guide', 'done')
        } catch {}
        setMicGuideOpen(false)
        setRecording(true)
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
                    {/* Save status — autosave's quiet word after the instrument chip; production shrinks it
                        to the check alone after 3s and reads "Not saved yet — retrying" while a save fails. */}
                    <span
                        role="status"
                        style={{
                            flexShrink: 0,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            font: '400 12px/1 var(--font-body)',
                            color: 'var(--color-on-surface-variant)',
                        }}>
                        <Icon name="check" size={12} />
                        Saved
                    </span>
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
                    {/* Its tooltip names "?", the key that opens the shortcuts list. */}
                    <ChipToggle active={shortcutsOn} onClick={() => setShortcutsOn((o) => !o)} ariaLabel="Keyboard shortcuts">
                        <Icon name="keyboard" size={16} />
                    </ChipToggle>
                    <ExportMenu />
                </div>
            </header>

            {limitDialogOpen && (
                <LimitReachedDialog
                    nextPlanName={tier.next}
                    nextLimitSec={Object.values(EDITOR_TIERS).find((t) => t.name === tier.next)?.dailyLimitSec}
                    limitSec={limitSec}
                    onClose={() => setLimitDialogOpen(false)}
                    onUpgrade={() => {
                        setLimitDialogOpen(false)
                        onUpgrade?.()
                    }}
                />
            )}
            {concurrentDialogOpen && <ConcurrentRecordingDialog onClose={() => setConcurrentDialogOpen(false)} />}
            {micGuideOpen && <MicModeGuideDialog onConfirm={confirmMicGuide} onClose={() => setMicGuideOpen(false)} />}
            {micReminderOn && <MicReminderToast onDone={() => setMicReminderOn(false)} />}

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
