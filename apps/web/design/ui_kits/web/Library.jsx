// Score library — list of saved scores with search and row hover.
// Columns mirror production (src/app/scores/page.tsx): Title / Created / Updated / actions.
const SAMPLE_SCORES = [
    { id: 'a', title: 'Allegro in C minor', created: 'Mar 4, 2026', updated: '2 hours ago' },
    { id: 'b', title: 'Nocturne — first draft', created: 'Feb 19, 2026', updated: 'Yesterday' },
    { id: 'c', title: 'Erhu sketch no. 4', created: 'Feb 11, 2026', updated: '3 days ago' },
    { id: 'd', title: 'Untitled composition', created: 'Jan 14, 2026', updated: 'Jan 14, 2026' },
]

// The free Sketch plan keeps a shelf of up to 5 scores; the server refuses the
// create beyond that (403 code 'score-limit') and the app shows ScoreLimitDialog.
const SKETCH_SCORE_LIMIT = 5

function ScoreRow({ score, hover, onOpen, onDelete }) {
    const [hovered, setHovered] = useState(hover ?? false)
    return (
        <div
            onMouseEnter={() => hover === undefined && setHovered(true)}
            onMouseLeave={() => hover === undefined && setHovered(false)}
            style={{
                position: 'relative',
                overflow: 'hidden',
                background: hovered ? 'var(--color-surface-container-high)' : 'var(--color-surface-container-lowest)',
                borderRadius: 8,
                padding: '18px 24px',
                boxShadow: '0 0 24px 0 rgba(45,47,47,0.06)',
                display: 'grid',
                gridTemplateColumns: '5fr 2fr 2fr 1fr',
                gap: 16,
                alignItems: 'center',
                transition: 'background 220ms var(--ease)',
            }}>
            <div
                style={{
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    bottom: 0,
                    width: 3,
                    background: 'var(--color-primary-container)',
                    opacity: hovered ? 1 : 0,
                    transition: 'opacity 220ms var(--ease)',
                }}
            />
            <button
                onClick={onOpen}
                style={{
                    textAlign: 'left',
                    background: 'transparent',
                    border: 0,
                    padding: 0,
                    cursor: 'pointer',
                    font: '500 16px/1.3 var(--font-body)',
                    color: hovered ? 'var(--color-primary)' : 'var(--color-on-surface)',
                    transition: 'color 220ms var(--ease)',
                }}>
                {score.title}
            </button>
            <span style={{ font: '400 13px/1 var(--font-body)', color: 'var(--color-on-surface-variant)' }}>{score.created}</span>
            <span style={{ font: '400 13px/1 var(--font-body)', color: 'var(--color-on-surface-variant)' }}>{score.updated}</span>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <IconButton
                    icon="pencil"
                    ariaLabel="Edit"
                    size={28}
                    idleBg={hovered ? 'var(--color-surface-container-lowest)' : undefined}
                    onClick={onOpen}
                />
                <IconButton
                    icon="trash-2"
                    ariaLabel="Delete"
                    size={28}
                    hoverTone="magenta"
                    idleBg={hovered ? 'var(--color-surface-container-lowest)' : undefined}
                    onClick={onDelete}
                />
            </div>
        </div>
    )
}

function Library({ scores, onOpen, onCreate, onDelete }) {
    const [search, setSearch] = useState('')
    // Deleting is destructive with no undo — always confirm first.
    const [deleteTarget, setDeleteTarget] = useState(null)
    // Mirrors the app's score-cap flow: at the Sketch limit the create is
    // refused and an upgrade conversation opens instead of the new-score dialog.
    const [limitOpen, setLimitOpen] = useState(false)
    const filtered = scores.filter((s) => s.title.toLowerCase().includes(search.toLowerCase()))

    const handleCreate = () => {
        if (scores.length >= SKETCH_SCORE_LIMIT) setLimitOpen(true)
        else onCreate()
    }
    return (
        <main
            data-screen-label="Library"
            style={{
                flex: 1,
                maxWidth: 1280,
                margin: '0 auto',
                padding: '40px 32px',
                display: 'flex',
                flexDirection: 'column',
                gap: 24,
                width: '100%',
                boxSizing: 'border-box',
            }}>
            <PageHeader
                title="Your scores"
                subtitle="A quiet shelf for everything you're working on."
                right={
                    <div style={{ width: 256 }}>
                        <TextField value={search} onChange={setSearch} leftIcon="search" placeholder="Find a score…" />
                    </div>
                }
            />

            {/* List header */}
            <div
                style={{
                    display: 'grid',
                    gridTemplateColumns: '5fr 2fr 2fr 1fr',
                    gap: 16,
                    padding: '8px 24px',
                    font: '600 11px/1 var(--font-label)',
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                    color: 'var(--color-outline)',
                }}>
                <span>Title</span>
                <span>Created</span>
                <span>Updated</span>
                <span></span>
            </div>

            {/* Rows */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {filtered.length === 0 ? (
                    search ? (
                        <div
                            style={{
                                background: 'var(--color-surface-container-lowest)',
                                borderRadius: 8,
                                padding: '40px 32px',
                                boxShadow: '0 0 24px 0 rgba(45,47,47,0.06)',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 12,
                                alignItems: 'center',
                                justifyContent: 'center',
                            }}>
                            <Icon name="search" size={32} color="var(--color-outline-variant)" />
                            <span style={{ font: '400 14px/1.5 var(--font-body)', color: 'var(--color-on-surface-variant)' }}>
                                No scores match "{search}".
                            </span>
                        </div>
                    ) : (
                        <div
                            style={{
                                background: 'var(--color-surface-container-lowest)',
                                borderRadius: 8,
                                padding: '40px 32px',
                                boxShadow: '0 0 24px 0 rgba(45,47,47,0.06)',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 28,
                            }}>
                            <svg viewBox="0 0 120 80" width="96" height="64" aria-hidden style={{ flexShrink: 0 }}>
                                {[0, 1, 2, 3, 4].map((i) => (
                                    <line
                                        key={i}
                                        x1={8}
                                        x2={112}
                                        y1={20 + i * 10}
                                        y2={20 + i * 10}
                                        stroke="var(--color-outline-variant)"
                                        strokeWidth={1}
                                    />
                                ))}
                                <text x={12} y={56} fontFamily="serif" fontSize={42} fill="var(--color-outline)">
                                    𝄞
                                </text>
                            </svg>
                            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
                                <span style={{ font: '600 16px/1.3 var(--font-body)', color: 'var(--color-on-surface)' }}>
                                    No scores yet.
                                </span>
                                <span style={{ font: '400 14px/1.5 var(--font-body)', color: 'var(--color-on-surface-variant)' }}>
                                    Compose your first one — it'll show up on this shelf.
                                </span>
                            </div>
                            <PrimaryButton icon="plus" onClick={handleCreate}>
                                New score
                            </PrimaryButton>
                        </div>
                    )
                ) : (
                    filtered.map((s, i) => <ScoreRow key={s.id} score={s} onOpen={() => onOpen(s)} onDelete={() => setDeleteTarget(s)} />)
                )}
            </div>

            {deleteTarget && (
                <DialogScrim onDismiss={() => setDeleteTarget(null)}>
                    <DialogPanel
                        title="Delete this score?"
                        subtitle={`“${deleteTarget.title}” will be gone for good — there's no undo.`}
                        width={440}
                        onClose={() => setDeleteTarget(null)}
                        footer={
                            <>
                                <TertiaryButton onClick={() => setDeleteTarget(null)}>Keep it</TertiaryButton>
                                <PrimaryButton
                                    danger
                                    onClick={() => {
                                        onDelete(deleteTarget)
                                        setDeleteTarget(null)
                                    }}>
                                    Delete score
                                </PrimaryButton>
                            </>
                        }
                    />
                </DialogScrim>
            )}

            {limitOpen && <ScoreLimitDialog onUpgrade={() => setLimitOpen(false)} onClose={() => setLimitOpen(false)} />}
        </main>
    )
}

// Shown when the server refuses a create because the plan's score cap is
// reached (403 code 'score-limit'). In production the cap and the upgrade
// target come from the database catalogue via GET /plans.
function ScoreLimitDialog({ planName = 'Sketch', limit = SKETCH_SCORE_LIMIT, nextPlanName = 'Songwriter', onUpgrade, onClose }) {
    return (
        <DialogScrim onDismiss={onClose}>
            <DialogPanel
                title={`Your ${planName} plan holds up to ${limit} scores.`}
                subtitle="Everything you've written is safe and stays fully editable — the shelf is full, not locked."
                onClose={onClose}
                width={480}
                footer={
                    <>
                        <TertiaryButton onClick={onClose}>Not now</TertiaryButton>
                        <PrimaryButton emphasis="pop" icon="arrow-right" onClick={onUpgrade}>
                            Upgrade to {nextPlanName}
                        </PrimaryButton>
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
                            <Icon name="file-music" size={20} />
                        </span>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                            <span style={{ font: '600 14px/1.3 var(--font-body)', color: 'var(--color-on-surface)' }}>
                                No room for a new score right now
                            </span>
                            <span style={{ font: '400 12px/1.4 var(--font-body)', color: 'var(--color-on-surface-variant)' }}>
                                Editing, playback, recording, and export keep working on every score you already have.
                            </span>
                        </div>
                    </div>
                    <span style={{ font: '400 13px/1.5 var(--font-body)', color: 'var(--color-on-surface-variant)' }}>
                        Upgrading to <strong style={{ color: 'var(--color-on-surface)' }}>{nextPlanName}</strong> lifts the cap
                        immediately.
                    </span>
                    <span style={{ font: '400 12px/1.5 var(--font-body)', color: 'var(--color-on-surface-variant)' }}>
                        Prefer to stay on {planName}? Deleting a score you no longer need frees up a slot.
                    </span>
                </div>
            </DialogPanel>
        </DialogScrim>
    )
}

Object.assign(window, { Library, ScoreLimitDialog, SAMPLE_SCORES })
