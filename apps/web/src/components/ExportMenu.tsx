'use client'

import { SCORE_WIDTH } from '@mushee/notation/engraving/constants'
import type { Score } from '@mushee/notation/model'
import { MidiExporter } from '@mushee/notation/model/io/MidiExporter'
import { MusicXmlExporter } from '@mushee/notation/model/io/MusicXmlExporter'
import { useCallback, useState } from 'react'
import { flushSync } from 'react-dom'

import { HeaderMenu, showToast } from '@/components/ui'
import { downloadBlob } from '@/lib/FileDownload'
import { PdfExporter } from '@/lib/PdfExporter'

type ExportFormat = 'musicxml' | 'pdf' | 'midi'

/** What a dabbler most often wants comes first: sheet music to print or send, then other apps. */
const FORMATS: Array<{ format: ExportFormat; label: string; description: string; extension: string }> = [
    { format: 'pdf', label: 'PDF', description: 'Print it or send it as sheet music', extension: '.pdf' },
    { format: 'midi', label: 'MIDI', description: 'Open it in GarageBand or other music apps', extension: '.mid' },
    { format: 'musicxml', label: 'MusicXML', description: 'Keep editing in MuseScore or other notation apps', extension: '.musicxml' },
]

interface ExportMenuProps {
    score: Score
    title: string
    /** The rendered score SVG, resolved at export time — needed for the PDF's visual snapshot. */
    getSvg: () => SVGSVGElement | null
    /** Icon-only trigger (the mobile header). */
    compact?: boolean
    /** The chip's visible text: 'Export' in the editor, 'Download' on the share page. */
    label?: string
    /** The chip's and panel's accessible name; it must contain `label` (WCAG 2.5.3). */
    ariaLabel?: string
    /** The panel's title (`title` is the score's, for the file names). */
    menuTitle?: string
    /** The chip's size: `lg` beside a page's big CTA (the shared score page). */
    size?: 'default' | 'lg'
}

/**
 * The score's download menu: PDF, MIDI or MusicXML, each with what it is for. A PDF takes a
 * moment to render ("Preparing PDF…"); every finished download is confirmed with the file's
 * name — never a folder, which the browser decides.
 */
export function ExportMenu({
    score,
    title,
    getSvg,
    compact = false,
    label = 'Export',
    ariaLabel = 'Export score',
    menuTitle = 'Download as',
    size,
}: ExportMenuProps) {
    // Held here, not in the panel: an export keeps running (and blocks a second one) after Escape closes the menu.
    const [busy, setBusy] = useState<ExportFormat | null>(null)

    const handleExport = useCallback(
        async (format: ExportFormat, onExported: () => void) => {
            if (busy) return
            const basename = title.replace(/[/\\:*?"<>|]/g, '').trim() || 'score'
            const { label: formatLabel, extension } = FORMATS.find((f) => f.format === format) ?? FORMATS[0]
            const filename = `${basename}${extension}`
            setBusy(format)
            try {
                if (format === 'musicxml') {
                    const xml = new MusicXmlExporter(score).toXml(title)
                    downloadBlob(new Blob([xml], { type: 'application/vnd.recordare.musicxml+xml' }), filename)
                } else if (format === 'midi') {
                    downloadBlob(new Blob([new MidiExporter(score).toBytes()], { type: 'audio/midi' }), filename)
                } else {
                    // The PDF is a print artifact: pin the layout to the standard page width
                    // for the snapshot (a phone displays a reflowed layout), restore after.
                    const displayWidth = score.layoutWidth
                    if (displayWidth !== SCORE_WIDTH) flushSync(() => score.setLayoutWidth(SCORE_WIDTH))
                    try {
                        const svg = getSvg()
                        if (!svg) throw new Error('Score is not rendered')
                        downloadBlob(await new PdfExporter(score, svg).toBlob(title), filename)
                    } finally {
                        if (displayWidth !== SCORE_WIDTH) flushSync(() => score.setLayoutWidth(displayWidth))
                    }
                }
                onExported()
                showToast(`Downloaded “${filename}”.`, 'info')
            } catch (err) {
                console.error(`Export to ${format} failed`, err)
                showToast(`The ${formatLabel} export failed. Please try again.`)
            } finally {
                setBusy(null)
            }
        },
        [busy, score, title, getSvg],
    )

    return (
        <HeaderMenu icon="download" label={label} compact={compact} ariaLabel={ariaLabel} title={menuTitle} size={size} className="gap-2">
            {({ close }) => (
                <div role="group" aria-label="Export format" className="flex flex-col gap-1.5">
                    {FORMATS.map(({ format, label: formatLabel, description, extension }) => (
                        <button
                            key={format}
                            type="button"
                            disabled={busy !== null}
                            onClick={() => void handleExport(format, close)}
                            className={[
                                'flex flex-col items-start justify-center gap-1.5 w-64 max-w-full px-3 py-2.5 pointer-coarse:min-h-11 rounded-md border-0 text-left',
                                'cursor-pointer disabled:cursor-not-allowed disabled:opacity-40',
                                'bg-surface-container-low hover:bg-surface-container',
                                'transition-colors duration-150 ease-solkey focus-ring',
                            ].join(' ')}>
                            <span className="flex w-full items-baseline justify-between gap-3">
                                <span className="font-label font-semibold text-[13px] leading-none text-on-surface">
                                    {busy === format ? `Preparing ${formatLabel}…` : formatLabel}
                                </span>
                                {/* Visual only: read aloud it would repeat the format's name ("PDF .pdf"). */}
                                <span aria-hidden className="font-mono text-[11px] leading-none text-on-surface-variant">
                                    {extension}
                                </span>
                            </span>
                            <span className="font-body font-normal text-[11px] leading-[1.35] text-on-surface-variant">{description}</span>
                        </button>
                    ))}
                </div>
            )}
        </HeaderMenu>
    )
}
