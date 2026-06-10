import { makeScore } from '@test/helpers'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PdfExporter } from '@/lib/PdfExporter'

// A 1x1 white JPEG (valid base64) so atob() decodes to real bytes in toJpeg().
const TINY_JPEG =
    'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA='

/** Decode the PDF Blob's bytes to a Latin1 string for assertions. */
async function blobToText(blob: Blob): Promise<{ text: string; bytes: Uint8Array }> {
    const buf = await blob.arrayBuffer()
    const bytes = new Uint8Array(buf)
    let text = ''
    for (let i = 0; i < bytes.length; i++) text += String.fromCharCode(bytes[i])
    return { text, bytes }
}

function fakeSvg(): SVGSVGElement {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    // Some chrome to strip + a colored element to force back to ink.
    const exclude = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
    exclude.setAttribute('data-export-exclude', '')
    svg.appendChild(exclude)
    const colored = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
    colored.setAttribute('fill', '#ff0000')
    colored.setAttribute('stroke', '#00ff00')
    svg.appendChild(colored)
    // Elements with none/transparent fills should be left untouched.
    const transparent = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
    transparent.setAttribute('fill', 'none')
    transparent.setAttribute('stroke', 'transparent')
    svg.appendChild(transparent)
    return svg
}

describe('PdfExporter', () => {
    let drawnTexts: string[]
    let drawImageCalls: number
    let lastImage: FakeImage | null
    // When set, decode() rejects with this error — lets a test exercise the finally branch.
    let decodeError: Error | null
    let createObjectURL: ReturnType<typeof vi.fn>
    let revokeObjectURL: ReturnType<typeof vi.fn>

    class FakeImage {
        naturalWidth = 1500
        naturalHeight = 480
        src = ''
        decode = vi.fn(() => (decodeError ? Promise.reject(decodeError) : Promise.resolve()))
        constructor() {
            rememberImage(this)
        }
    }
    const rememberImage = (image: FakeImage): void => {
        lastImage = image
    }

    beforeEach(() => {
        drawnTexts = []
        drawImageCalls = 0
        lastImage = null
        decodeError = null

        createObjectURL = vi.fn(() => 'blob:fake')
        revokeObjectURL = vi.fn()

        vi.stubGlobal('Image', FakeImage)
        vi.stubGlobal('URL', {
            createObjectURL,
            revokeObjectURL,
        })

        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
            () =>
                ({
                    fillRect: vi.fn(),
                    fillText: vi.fn((text: string) => {
                        drawnTexts.push(text)
                    }),
                    drawImage: vi.fn(() => {
                        drawImageCalls++
                    }),
                    set font(_v: string) {},
                    set fillStyle(_v: string) {},
                    set textAlign(_v: string) {},
                }) as unknown as CanvasRenderingContext2D,
        )
        vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(TINY_JPEG)
    })

    afterEach(() => {
        vi.unstubAllGlobals()
        vi.restoreAllMocks()
    })

    it('produces a valid single-page PDF Blob for a short score', async () => {
        const score = makeScore(4) // one row, fits on one page
        const exporter = new PdfExporter(score, fakeSvg())
        const blob = await exporter.toBlob('Sonata in C')

        expect(blob).toBeInstanceOf(Blob)
        expect(blob.type).toBe('application/pdf')

        const { text } = await blobToText(blob)
        expect(text.startsWith('%PDF-1.4')).toBe(true)
        expect(text).toContain('/Type /Catalog')
        expect(text).toContain('%%EOF')
        // Exactly one page object for a one-row score.
        expect(text.match(/\/Type \/Page\b/g)).toHaveLength(1)
        // The title and the instrument name were drawn on the first page.
        expect(drawnTexts).toContain('Sonata in C')
        expect(drawnTexts).toContain(score.instrument.displayName.toUpperCase())
    })

    it('paginates a tall score into multiple pages', async () => {
        // 40 measures => 10 rows (4 per row), which overflows one A4 page.
        const score = makeScore(40)
        expect(score.rows.length).toBeGreaterThan(7)
        const exporter = new PdfExporter(score, fakeSvg())
        const blob = await exporter.toBlob('Long Etude')

        const { text } = await blobToText(blob)
        const pages = text.match(/\/Type \/Page\b/g) ?? []
        expect(pages.length).toBeGreaterThanOrEqual(2)
        // /Count in the Pages tree matches the number of page objects.
        expect(text).toContain(`/Count ${pages.length}`)
        // One JPEG image is drawn per page.
        expect(drawImageCalls).toBe(pages.length)
        // Title drawn only once (first page only).
        expect(drawnTexts.filter((t) => t === 'Long Etude')).toHaveLength(1)
    })

    it('rasterizes via an Image, decoding the serialized SVG and revoking the object URL', async () => {
        const score = makeScore(4)
        const exporter = new PdfExporter(score, fakeSvg())
        await exporter.toBlob('X')

        const image = lastImage
        expect(image).not.toBeNull()
        if (!image) throw new Error('expected an image to be created')
        expect(image.src).toBe('blob:fake')
        expect(image.decode).toHaveBeenCalled()
        expect(createObjectURL).toHaveBeenCalled()
        expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake')
    })

    it('embeds a DCTDecode image XObject per page with the catalog/pages/xref scaffolding', async () => {
        const score = makeScore(4)
        const exporter = new PdfExporter(score, fakeSvg())
        const blob = await exporter.toBlob('X')
        const { text } = await blobToText(blob)

        expect(text).toContain('/Type /Pages')
        expect(text).toContain('/Filter /DCTDecode')
        expect(text).toContain('/XObject')
        expect(text).toContain('xref')
        expect(text).toContain('trailer')
        expect(text).toContain('/Root 1 0 R')
    })

    it('revokes the object URL even if image decoding rejects', async () => {
        decodeError = new Error('bad image')
        const score = makeScore(4)
        const exporter = new PdfExporter(score, fakeSvg())
        await expect(exporter.toBlob('X')).rejects.toThrow('bad image')
        expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake')
    })

    it('throws when the canvas 2D context is unavailable', async () => {
        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
        const score = makeScore(4)
        const exporter = new PdfExporter(score, fakeSvg())
        await expect(exporter.toBlob('X')).rejects.toThrow('Canvas 2D context unavailable')
    })
})
