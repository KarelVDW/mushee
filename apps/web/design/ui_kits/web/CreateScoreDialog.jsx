// Create-score dialog with instrument picker.
// Representative subset of the app's real catalogue, grouped the way the app groups
// it: display names + families from Instrument.selectableByCategory(), which lives in
// packages/notation/src/model/Instrument.ts (imported app-side as `@mushee/notation/model`).
// Picker order: Keyboard · Brass · Woodwinds · Voice · Strings · Folk & World, alphabetical
// within each group. Guitar and Bass Guitar are real Strings entries; Harp is not offered.
const INSTRUMENT_CATEGORIES = [
    ['Keyboard', ['Piano']],
    ['Brass', ['Baritone Horn', 'Euphonium', 'French Horn', 'Trombone', 'Trumpet', 'Tuba']],
    [
        'Woodwinds',
        [
            'Alto Flute',
            'Alto Saxophone',
            'Baritone Saxophone',
            'Bass Clarinet',
            'Bassoon',
            'Clarinet',
            'Contrabassoon',
            'English Horn',
            'Flute',
            'Oboe',
            'Piccolo',
            'Recorder',
            'Soprano Saxophone',
            'Tenor Saxophone',
        ],
    ],
    ['Voice', ['Voice']],
    ['Strings', ['Bass Guitar', 'Cello', 'Contrabass', 'Guitar', 'Viola', 'Violin']],
    ['Folk & World', ['Bagpipe', 'Dizi Flute', 'Erhu', 'Harmonica', 'Ocarina', 'Pan Flute', 'Shakuhachi Flute', 'Tin Whistle']],
]

function InstrumentPicker({ value, onChange }) {
    const [search, setSearch] = useState('')
    const q = search.toLowerCase()
    // Filter within each family, then drop families with no remaining matches.
    const groups = INSTRUMENT_CATEGORIES.map(([category, names]) => [
        category,
        names.filter((i) => i.toLowerCase().includes(q)),
    ]).filter(([, names]) => names.length > 0)
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
                    flexDirection: 'column',
                    gap: 14,
                    padding: '4px 0',
                }}>
                {groups.map(([category, names]) => (
                    <div key={category} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <Eyebrow>{category}</Eyebrow>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                            {names.map((i) => (
                                <Chip key={i} active={i === value} onClick={() => onChange(i)} ariaLabel={`Pick ${i}`}>
                                    {i}
                                </Chip>
                            ))}
                        </div>
                    </div>
                ))}
                {groups.length === 0 && (
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
