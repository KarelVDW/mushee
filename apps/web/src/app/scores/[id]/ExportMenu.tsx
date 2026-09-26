'use client'

import { SCORE_WIDTH } from '@mushee/notation/components/constants'
import type { Score } from '@mushee/notation/model'
import { MidiExporter } from '@mushee/notation/model/util/MidiExporter'
import { MusicXmlExporter } from '@mushee/notation/model/util/MusicXmlExporter'
import { useCallback, useState } from 'react'
import { flushSync } from 'react-dom'

import { ChipToggle, Eyebrow, Icon, showToast } from '@/components/ui'
import { downloadBlob } from '@/lib/FileDownload'
import { PdfExporter } from '@/lib/PdfExporter'
import { useDismissablePopover } from '@/lib/useDismissablePopover'

type ExportFormat = 'musicxml' | 'pdf' | 'midi'

const FORMATS: Array<{ format: ExportFormat; label: string; description: string }> = [
    { format: 'musicxml', label: 'MusicXML', description: 'For other notation apps (.musicxml)' },
    { format: 'pdf', label: 'PDF', description: 'Print-ready sheet music (.pdf)' },
    { format: 'midi', label: 'MIDI', description: 'For DAWs and players (.mid)' },
]

interface ExportMenuProps {
    score: Score
    title: string
    /** The rendered score SVG, resolved at export time — needed for the PDF's visual snapshot. */
    getSvg: () => SVGSVGElement | null
    /** Icon-only trigger (the mobile header). */
    compact?: boolean
}

export function ExportMenu({ score, title, getSvg, compact = false }: ExportMenuProps) {
    const { open, setOpen, anchorRef, popRef } = useDismissablePopover()
    const [busy, setBusy] = useState<ExportFormat | null>(null)

    const handleExport = useCallback(
        async (format: ExportFormat) => {
            if (busy) return
            const basename = title.replace(/[/\\:*?"<>|]/g, '').trim() || 'score'
            setBusy(format)
            try {
                if (format === 'musicxml') {
                    const xml = new MusicXmlExporter(score).toXml(title)
                    downloadBlob(new Blob([xml], { type: 'application/vnd.recordare.musicxml+xml' }), `${basename}.musicxml`)
                } else if (format === 'midi') {
                    downloadBlob(new Blob([new MidiExporter(score).toBytes()], { type: 'audio/midi' }), `${basename}.mid`)
                } else {
                    // The PDF is a print artifact: pin the layout to the standard page width
                    // for the snapshot (a phone displays a reflowed layout), restore after.
                    const displayWidth = score.layoutWidth
                    if (displayWidth !== SCORE_WIDTH) flushSync(() => score.setLayoutWidth(SCORE_WIDTH))
                    try {
                        const svg = getSvg()
                        if (!svg) throw new Error('Score is not rendered')
                        downloadBlob(await new PdfExporter(score, svg).toBlob(title), `${basename}.pdf`)
                    } finally {
                        if (displayWidth !== SCORE_WIDTH) flushSync(() => score.setLayoutWidth(displayWidth))
                    }
                }
                setOpen(false)
            } catch (err) {
                console.error(`Export to ${format} failed`, err)
                showToast(`The ${FORMATS.find((f) => f.format === format)?.label ?? format} export failed. Please try again.`)
            } finally {
                setBusy(null)
            }
        },
        [busy, score, title, getSvg],
    )

    return (
        <div ref={anchorRef} className="relative shrink-0">
            <ChipToggle active={open} onClick={() => setOpen((o) => !o)} ariaLabel="Export score">
                <span className="inline-flex items-center gap-1.5">
                    <Icon name="download" size={14} />
                    {!compact && 'Export'}
                </span>
            </ChipToggle>
            {open && (
                <div
                    ref={popRef}
                    role="dialog"
                    aria-label="Export score"
                    className="glass-panel tonal-layer-glow absolute z-50 flex flex-col gap-2 p-4 rounded-lg right-0 top-[calc(100%+0.5rem)]"
                    onMouseDown={(e) => e.stopPropagation()}>
                    <Eyebrow>Export as</Eyebrow>
                    <div role="group" aria-label="Export format" className="flex flex-col gap-1.5">
                        {FORMATS.map(({ format, label, description }) => (
                            <button
                                key={format}
                                type="button"
                                disabled={busy !== null}
                                onClick={() => void handleExport(format)}
                                className={[
                                    'flex flex-col items-start gap-1 w-56 px-3 py-2.5 rounded-md border-0 text-left',
                                    'cursor-pointer disabled:cursor-not-allowed disabled:opacity-40',
                                    'bg-surface-container-low hover:bg-surface-container',
                                    'transition-colors duration-150 ease-solkey',
                                ].join(' ')}>
                                <span className="font-label font-semibold text-[13px] leading-none text-on-surface">
                                    {busy === format ? `Exporting ${label}…` : label}
                                </span>
                                <span className="font-body font-normal text-[11px] leading-none text-on-surface-variant">
                                    {description}
                                </span>
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    )
}
