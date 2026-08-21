'use client'

import { Instrument } from '@mushee/notation/model/Instrument'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'

import { ScoreView } from '@/components/ScoreView'
import { Alert, Card, Chip, Eyebrow, PrimaryButton, TextArea, TextField } from '@/components/ui'
import { melodyToScore, playbackInstrument } from '@/lib/buildScore'
import { generateClips, type GeneratorParams, REGISTER_PRESETS } from '@/lib/generator'
import { melodyNoteCount } from '@/lib/melody'
import { useCreateCorpus } from '@/lib/queries'

const KINDS = ['voice', 'whistle', 'instrument'] as const
const TIERS = ['context', 'benchmark'] as const
const MODES = ['major', 'minor', 'mixed'] as const
const RHYTHMS = ['simple', 'varied', 'complex'] as const

export default function NewCorpusPage() {
    const router = useRouter()
    const create = useCreateCorpus()

    const [label, setLabel] = useState('')
    const [kind, setKind] = useState<(typeof KINDS)[number]>('voice')
    const [instrumentId, setInstrumentId] = useState('')
    const [tier, setTier] = useState<(typeof TIERS)[number]>('context')
    const [notes, setNotes] = useState('')
    const [bpm, setBpm] = useState('90')
    const [beatsPerMeasure, setBeatsPerMeasure] = useState(4)
    const [measuresPerClip, setMeasuresPerClip] = useState('4')
    const [clipCount, setClipCount] = useState('8')
    const [registerKey, setRegisterKey] = useState('mid')
    const [mode, setMode] = useState<(typeof MODES)[number]>('major')
    const [rhythm, setRhythm] = useState<(typeof RHYTHMS)[number]>('varied')
    const [leapProb, setLeapProb] = useState('0.15')
    const [restProb, setRestProb] = useState('0.10')
    // Random default seed arrives AFTER mount: an initializer that rolls the
    // dice would roll differently on server and client and break hydration.
    const [seed, setSeed] = useState('')
    useEffect(() => {
        setSeed((current) => current || String(Math.floor(Math.random() * 1_000_000)))
    }, [])

    const params: GeneratorParams = useMemo(
        () => ({
            seed: Number(seed) || 1,
            clipCount: Math.max(1, Math.min(50, Number(clipCount) || 1)),
            bpm: Math.max(30, Math.min(220, Number(bpm) || 90)),
            beatsPerMeasure,
            measuresPerClip: Math.max(1, Math.min(16, Number(measuresPerClip) || 4)),
            register: REGISTER_PRESETS[registerKey] ?? REGISTER_PRESETS.mid,
            mode,
            leapProb: Math.max(0, Math.min(0.6, Number(leapProb) || 0)),
            restProb: Math.max(0, Math.min(0.5, Number(restProb) || 0)),
            rhythm,
        }),
        [seed, clipCount, bpm, beatsPerMeasure, measuresPerClip, registerKey, mode, leapProb, restProb, rhythm],
    )

    const preview = useMemo(() => {
        try {
            const instrument = playbackInstrument(kind, instrumentId || null)
            return {
                clips: generateClips({ ...params, clipCount: Math.min(2, params.clipCount) }).map((clip) => ({
                    ...clip,
                    score: melodyToScore(clip.melody, instrument),
                })),
                error: null as string | null,
            }
        } catch (err) {
            return { clips: [], error: String(err) }
        }
    }, [params, kind, instrumentId])

    const submit = () => {
        create.mutate(
            {
                label,
                kind,
                instrumentId: kind === 'instrument' && instrumentId ? instrumentId : undefined,
                tier,
                notes: notes || undefined,
                params,
            },
            { onSuccess: ({ id }) => router.push(`/corpora/${id}`) },
        )
    }

    return (
        <div className="grid grid-cols-1 lg:grid-cols-[24rem_1fr] gap-6 items-start">
            <Card className="flex flex-col gap-5">
                <h1 className="font-headline font-bold text-[1.3rem] leading-tight text-on-surface m-0">New corpus</h1>

                <TextField label="Label" value={label} onChange={setLabel} placeholder="Whistled mid-register set" autoFocus />

                <ChipRow label="Source kind" options={KINDS} value={kind} onChange={setKind} />
                {kind === 'instrument' && (
                    <SelectField
                        label="Instrument (pipeline hint + replay sound)"
                        value={instrumentId}
                        onChange={setInstrumentId}
                        options={Instrument.selectable().map((i) => ({ value: i.id, label: i.displayName ?? i.id }))}
                    />
                )}
                <ChipRow
                    label="Tier (benchmark may gate decisions)"
                    options={TIERS}
                    value={tier}
                    onChange={setTier}
                />

                <div className="grid grid-cols-2 gap-3">
                    <TextField label="BPM" value={bpm} onChange={setBpm} type="number" />
                    <div className="flex flex-col gap-1.5">
                        <Eyebrow>Time signature</Eyebrow>
                        <div className="flex gap-2">
                            {[4, 3].map((b) => (
                                <Chip key={b} active={beatsPerMeasure === b} onClick={() => setBeatsPerMeasure(b)}>
                                    {b}/4
                                </Chip>
                            ))}
                        </div>
                    </div>
                    <TextField label="Measures per clip" value={measuresPerClip} onChange={setMeasuresPerClip} type="number" />
                    <TextField label="Clip count" value={clipCount} onChange={setClipCount} type="number" />
                </div>

                <SelectField
                    label="Register"
                    value={registerKey}
                    onChange={setRegisterKey}
                    options={Object.entries(REGISTER_PRESETS).map(([value, preset]) => ({ value, label: preset.label }))}
                />
                <ChipRow label="Keys" options={MODES} value={mode} onChange={setMode} />
                <ChipRow label="Rhythm" options={RHYTHMS} value={rhythm} onChange={setRhythm} />

                <div className="grid grid-cols-2 gap-3">
                    <TextField label="Leap probability" value={leapProb} onChange={setLeapProb} type="number" hint="0–0.6" />
                    <TextField label="Rest probability" value={restProb} onChange={setRestProb} type="number" hint="0–0.5" />
                </div>
                <TextField
                    label="Seed"
                    value={seed}
                    onChange={setSeed}
                    type="number"
                    hint="Same seed + params ⇒ same clips, forever."
                    rightSlot={
                        <button
                            type="button"
                            className="bg-transparent border-0 cursor-pointer font-label text-[12px] text-primary"
                            onClick={() => setSeed(String(Math.floor(Math.random() * 1_000_000)))}>
                            reroll
                        </button>
                    }
                />
                <TextArea label="Notes" value={notes} onChange={setNotes} placeholder="Why this corpus exists, recording conditions…" rows={3} />

                {create.isError && <Alert>{String(create.error)}</Alert>}
                <PrimaryButton emphasis="pop" disabled={!label.trim() || create.isPending || !!preview.error} onClick={submit}>
                    {create.isPending ? 'Creating…' : `Create ${params.clipCount} clips`}
                </PrimaryButton>
            </Card>

            <div className="flex flex-col gap-4">
                <Eyebrow>Preview — first two clips of this seed</Eyebrow>
                {preview.error && <Alert>{preview.error}</Alert>}
                {preview.clips.map((clip) => (
                    <Card key={clip.name}>
                        <div className="flex items-baseline justify-between mb-2">
                            <span className="font-body font-semibold text-[14px] text-on-surface">{clip.name}</span>
                            <span className="font-mono text-[12px] text-on-surface-variant">
                                {clip.melody.keyLabel} · {melodyNoteCount(clip.melody)} notes · seed {clip.seed}
                            </span>
                        </div>
                        <ScoreView score={clip.score} />
                    </Card>
                ))}
            </div>
        </div>
    )
}

function ChipRow<T extends string>({
    label,
    options,
    value,
    onChange,
}: {
    label: string
    options: readonly T[]
    value: T
    onChange: (v: T) => void
}) {
    return (
        <div className="flex flex-col gap-1.5">
            <Eyebrow>{label}</Eyebrow>
            <div className="flex gap-2 flex-wrap">
                {options.map((option) => (
                    <Chip key={option} active={value === option} onClick={() => onChange(option)}>
                        {option}
                    </Chip>
                ))}
            </div>
        </div>
    )
}

function SelectField({
    label,
    value,
    onChange,
    options,
}: {
    label: string
    value: string
    onChange: (v: string) => void
    options: Array<{ value: string; label: string }>
}) {
    return (
        <div className="flex flex-col gap-1.5">
            <Eyebrow>{label}</Eyebrow>
            <select
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="bg-surface-container-low rounded-sm border-0 outline-0 text-on-surface font-body text-[14px] py-3 px-2.5 focus-visible:outline-2 focus-visible:outline-primary">
                <option value="">—</option>
                {options.map((option) => (
                    <option key={option.value} value={option.value}>
                        {option.label}
                    </option>
                ))}
            </select>
        </div>
    )
}
