// Create-score dialog with instrument picker.
// Representative subset of the app's real instrument catalogue — display names
// from Instrument.selectable() in src/model/Instrument.ts. Keep names verbatim
// (no instruments the product doesn't have).
const ALL_INSTRUMENTS = [
    'Piano',
    'Violin',
    'Viola',
    'Cello',
    'Contrabass',
    'Flute',
    'Piccolo',
    'Alto Flute',
    'Oboe',
    'English Horn',
    'Clarinet',
    'Bass Clarinet',
    'Bassoon',
    'Contrabassoon',
    'Soprano Saxophone',
    'Alto Saxophone',
    'Tenor Saxophone',
    'Baritone Saxophone',
    'Trumpet',
    'Trombone',
    'French Horn',
    'Tuba',
    'Euphonium',
    'Baritone Horn',
    'Harmonica',
    'Recorder',
    'Tin Whistle',
    'Pan Flute',
    'Ocarina',
    'Bagpipe',
    'Erhu',
    'Dizi Flute',
    'Shakuhachi Flute',
]

function InstrumentPicker({ value, onChange }) {
    const [search, setSearch] = useState('')
    const filtered = ALL_INSTRUMENTS.filter((i) => i.toLowerCase().includes(search.toLowerCase()))
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1, minHeight: 0 }}>
            <Eyebrow>Lead instrument · {value}</Eyebrow>
            <TextField value={search} onChange={setSearch} leftIcon="search" placeholder="Filter instruments…" />
            <div
                style={{
                    flex: 1,
                    minHeight: 160,
                    overflowY: 'auto',
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 8,
                    alignContent: 'flex-start',
                    padding: '4px 0',
                }}>
                {filtered.map((i) => (
                    <Chip key={i} active={i === value} onClick={() => onChange(i)} ariaLabel={`Pick ${i}`}>
                        {i}
                    </Chip>
                ))}
                {filtered.length === 0 && (
                    <span style={{ font: '400 13px/1.5 var(--font-body)', color: 'var(--color-on-surface-variant)', padding: 4 }}>
                        No instruments match "{search}"
                    </span>
                )}
            </div>
        </div>
    )
}

function CreateScoreDialog({ onCancel, onCreate }) {
    const [title, setTitle] = useState('')
    const [instrument, setInstrument] = useState('Piano')
    const canSubmit = title.trim().length > 0
    return (
        <DialogScrim onDismiss={onCancel}>
            <DialogPanel
                title="New score"
                subtitle="Give it a name and pick a lead instrument."
                onClose={onCancel}
                width={620}
                footer={
                    <>
                        <TertiaryButton onClick={onCancel}>Cancel</TertiaryButton>
                        <PrimaryButton emphasis="pop" disabled={!canSubmit} onClick={() => canSubmit && onCreate(title.trim(), instrument)}>
                            Create score
                        </PrimaryButton>
                    </>
                }>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16, flex: 1, minHeight: 0, paddingBottom: 12 }}>
                    <TextField label="Title" value={title} onChange={setTitle} placeholder="Untitled composition" autoFocus />
                    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                        <InstrumentPicker value={instrument} onChange={setInstrument} />
                    </div>
                </div>
            </DialogPanel>
        </DialogScrim>
    )
}

Object.assign(window, { CreateScoreDialog, InstrumentPicker })
