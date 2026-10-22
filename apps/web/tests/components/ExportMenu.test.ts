import { Score } from '@mushee/notation/model'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { downloadBlob, showToast, pdf } = vi.hoisted(() => ({
    downloadBlob: vi.fn(),
    showToast: vi.fn(),
    pdf: { resolve: null as ((blob: Blob) => void) | null },
}))

vi.mock('@/lib/FileDownload', () => ({ downloadBlob }))
vi.mock('@/components/ui', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/components/ui')>()),
    showToast,
}))
vi.mock('@/lib/PdfExporter', () => ({
    PdfExporter: class {
        toBlob() {
            return new Promise<Blob>((resolve) => {
                pdf.resolve = resolve
            })
        }
    },
}))

import { ExportMenu } from '@/components/ExportMenu'

// React's act() refuses to run outside a test-aware environment.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('ExportMenu', () => {
    let host: HTMLElement
    let root: Root

    beforeEach(() => {
        downloadBlob.mockClear()
        showToast.mockClear()
        host = document.createElement('div')
        document.body.appendChild(host)
        root = createRoot(host)
    })

    afterEach(() => {
        act(() => root.unmount())
        host.remove()
    })

    function render(props: Partial<Parameters<typeof ExportMenu>[0]> = {}) {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
        act(() => root.render(createElement(ExportMenu, { score: new Score(), title: 'My tune', getSvg: () => svg, ...props })))
    }
    const chip = (name: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)
    const formats = () => [...host.querySelectorAll<HTMLButtonElement>('[role="group"][aria-label="Export format"] button')]

    it('leads with PDF, says what each format is for, and shows its extension', () => {
        render()
        act(() => chip('Export score')?.click())
        expect(host.querySelector('[role="dialog"]')?.textContent).toContain('Download as')
        expect(formats().map((b) => b.querySelector('span span')?.textContent)).toEqual(['PDF', 'MIDI', 'MusicXML'])
        const [pdfRow, midi, musicxml] = formats().map((b) => b.textContent)
        expect(pdfRow).toBe('PDF.pdfPrint it or send it as sheet music')
        expect(midi).toBe('MIDI.midOpen it in GarageBand or other music apps')
        expect(musicxml).toBe('MusicXML.musicxmlKeep editing in MuseScore or other notation apps')
        // No jargon: "DAW" is gone.
        expect(host.textContent).not.toMatch(/DAW/)
        // Coarse pointers get a 44px row, keyboards the shared ring.
        expect(formats()[0].className).toContain('pointer-coarse:min-h-11')
        expect(formats()[0].className).toContain('focus-ring')
    })

    it('confirms a finished download with the file’s name and closes', () => {
        render()
        act(() => chip('Export score')?.click())
        act(() => formats()[1].click())
        expect(downloadBlob).toHaveBeenCalledWith(expect.any(Blob), 'My tune.mid')
        expect(showToast).toHaveBeenCalledWith('Downloaded “My tune.mid”.', 'info')
        expect(host.querySelector('[role="dialog"]')).toBeNull()
    })

    it('says "Preparing PDF…" while the PDF renders', async () => {
        render()
        act(() => chip('Export score')?.click())
        act(() => formats()[0].click())
        expect(formats()[0].textContent).toContain('Preparing PDF…')
        expect(formats().every((b) => b.disabled)).toBe(true)
        await act(async () => pdf.resolve?.(new Blob(['%PDF-'])))
        expect(downloadBlob).toHaveBeenCalledWith(expect.any(Blob), 'My tune.pdf')
        expect(showToast).toHaveBeenCalledWith('Downloaded “My tune.pdf”.', 'info')
    })

    it('takes its own chip text and name, which contains that text (the share page’s Download)', () => {
        render({ label: 'Download', ariaLabel: 'Download score' })
        expect(chip('Download score')?.textContent).toBe('Download')
        expect(chip('Export score')).toBeNull()
    })
})
