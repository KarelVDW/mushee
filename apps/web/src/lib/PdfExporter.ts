import type { Score } from '@/model'

// A4 in PDF points (1/72")
const PAGE_WIDTH = 595.28
const PAGE_HEIGHT = 841.89
const MARGIN = 48
/** Vertical space reserved for the title block on the first page, in points. */
const TITLE_BLOCK_HEIGHT = 84
/** Canvas pixels per PDF point (~216 dpi) — keeps glyph edges crisp in print without huge files. */
const RASTER_SCALE = 3
const JPEG_QUALITY = 0.95
const INK = '#2d2f2f'

interface PageImage {
    bytes: Uint8Array
    width: number
    height: number
}

/**
 * Renders the score as a paginated A4 PDF. The on-screen SVG is self-contained
 * (notation glyphs are inlined Bravura paths), so it is cloned, stripped of
 * editor chrome (`data-export-exclude` nodes, selection coloring), rasterized,
 * and sliced into pages at row boundaries.
 */
export class PdfExporter {
    constructor(
        readonly score: Score,
        readonly svg: SVGSVGElement,
    ) {}

    async toBlob(title: string): Promise<Blob> {
        const pointsPerUnit = (PAGE_WIDTH - MARGIN * 2) / this.score.layout.scoreWidth
        const image = await this.rasterize(pointsPerUnit * RASTER_SCALE)
        const pages = this.composePages(image, pointsPerUnit, title)
        return new Blob([PdfExporter.buildPdf(pages.map((canvas) => PdfExporter.toJpeg(canvas)))], { type: 'application/pdf' })
    }

    /** Clone the live SVG, strip editor chrome, and rasterize it at `pixelsPerUnit` canvas pixels per SVG unit. */
    private async rasterize(pixelsPerUnit: number): Promise<HTMLImageElement> {
        const clone = this.svg.cloneNode(true) as SVGSVGElement
        for (const el of clone.querySelectorAll('[data-export-exclude]')) el.remove()
        // The sheet is strictly monochrome by design — anything still colored is editor state
        // (e.g. the selected note's highlight), so force every painted element back to ink.
        for (const el of clone.querySelectorAll('[fill], [stroke]')) {
            const fill = el.getAttribute('fill')
            if (fill && fill !== 'none' && fill !== 'transparent') el.setAttribute('fill', '#000')
            const stroke = el.getAttribute('stroke')
            if (stroke && stroke !== 'none' && stroke !== 'transparent') el.setAttribute('stroke', '#000')
        }
        // Natural size at the final raster resolution, so the browser rasterizes the vectors sharply.
        clone.setAttribute('width', String(Math.ceil(this.score.layout.scoreWidth * pixelsPerUnit)))
        clone.setAttribute('height', String(Math.ceil(this.score.layout.totalHeight * pixelsPerUnit)))
        const markup = new XMLSerializer().serializeToString(clone)
        const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }))
        try {
            const image = new Image()
            image.src = url
            await image.decode()
            return image
        } finally {
            URL.revokeObjectURL(url)
        }
    }

    /** Draw the rasterized score onto A4-sized canvases, breaking pages between rows. */
    private composePages(image: HTMLImageElement, pointsPerUnit: number, title: string): HTMLCanvasElement[] {
        const layout = this.score.layout
        const rowStride = layout.rowHeight + layout.rowGap
        const rowCount = layout.rows.length
        const pixelsPerUnit = pointsPerUnit * RASTER_SCALE
        const rowsPerPage = (firstPage: boolean) => {
            const usableUnits = (PAGE_HEIGHT - MARGIN * 2 - (firstPage ? TITLE_BLOCK_HEIGHT : 0)) / pointsPerUnit
            return Math.max(1, Math.floor((usableUnits + layout.rowGap) / rowStride))
        }

        const canvases: HTMLCanvasElement[] = []
        let row = 0
        do {
            const firstPage = canvases.length === 0
            const rows = Math.min(rowsPerPage(firstPage), rowCount - row)
            const canvas = document.createElement('canvas')
            canvas.width = Math.round(PAGE_WIDTH * RASTER_SCALE)
            canvas.height = Math.round(PAGE_HEIGHT * RASTER_SCALE)
            const ctx = canvas.getContext('2d')
            if (!ctx) throw new Error('Canvas 2D context unavailable')
            ctx.fillStyle = '#ffffff'
            ctx.fillRect(0, 0, canvas.width, canvas.height)

            let contentTop = MARGIN
            if (firstPage) {
                ctx.textAlign = 'center'
                ctx.fillStyle = INK
                ctx.font = `italic ${26 * RASTER_SCALE}px Georgia, 'Times New Roman', serif`
                ctx.fillText(title, canvas.width / 2, (MARGIN + 32) * RASTER_SCALE)
                ctx.fillStyle = '#6f7272'
                ctx.font = `600 ${9 * RASTER_SCALE}px 'Space Grotesk', system-ui, sans-serif`
                ctx.fillText(this.score.instrument.displayName.toUpperCase(), canvas.width / 2, (MARGIN + 52) * RASTER_SCALE)
                contentTop += TITLE_BLOCK_HEIGHT
            }
            if (rows > 0) {
                const sourceY = row * rowStride * pixelsPerUnit
                const sourceHeight = ((rows - 1) * rowStride + layout.rowHeight) * pixelsPerUnit
                ctx.drawImage(
                    image,
                    0,
                    sourceY,
                    image.naturalWidth,
                    sourceHeight,
                    MARGIN * RASTER_SCALE,
                    contentTop * RASTER_SCALE,
                    layout.scoreWidth * pointsPerUnit * RASTER_SCALE,
                    (sourceHeight / pixelsPerUnit) * pointsPerUnit * RASTER_SCALE,
                )
            }
            canvases.push(canvas)
            row += rows
        } while (row < rowCount)
        return canvases
    }

    private static toJpeg(canvas: HTMLCanvasElement): PageImage {
        const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY)
        const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
        const binary = atob(base64)
        const bytes = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
        return { bytes, width: canvas.width, height: canvas.height }
    }

    /** Assemble a minimal PDF: one full-page DCT-encoded (JPEG) image XObject per page. */
    private static buildPdf(images: PageImage[]): Uint8Array<ArrayBuffer> {
        const encoder = new TextEncoder()
        const parts: Uint8Array[] = []
        const offsets: number[] = []
        let offset = 0
        const push = (value: string | Uint8Array) => {
            const bytes = typeof value === 'string' ? encoder.encode(value) : value
            parts.push(bytes)
            offset += bytes.length
        }
        const beginObject = (id: number) => {
            offsets[id] = offset
            push(`${id} 0 obj\n`)
        }

        // Objects: 1 catalog, 2 pages, then [page, contents, image] per page.
        const pageId = (index: number) => 3 + index * 3
        push('%PDF-1.4\n')
        beginObject(1)
        push('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n')
        beginObject(2)
        push(`<< /Type /Pages /Kids [${images.map((_, i) => `${pageId(i)} 0 R`).join(' ')}] /Count ${images.length} >>\nendobj\n`)
        images.forEach((image, i) => {
            beginObject(pageId(i))
            push(
                `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
                    `/Resources << /XObject << /Im0 ${pageId(i) + 2} 0 R >> >> /Contents ${pageId(i) + 1} 0 R >>\nendobj\n`,
            )
            const content = `q ${PAGE_WIDTH} 0 0 ${PAGE_HEIGHT} 0 0 cm /Im0 Do Q`
            beginObject(pageId(i) + 1)
            push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`)
            beginObject(pageId(i) + 2)
            push(
                `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} ` +
                    `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.bytes.length} >>\nstream\n`,
            )
            push(image.bytes)
            push('\nendstream\nendobj\n')
        })

        const objectCount = 2 + images.length * 3
        const xrefOffset = offset
        push(`xref\n0 ${objectCount + 1}\n0000000000 65535 f \n`)
        for (let id = 1; id <= objectCount; id++) push(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`)
        push(`trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`)

        const result = new Uint8Array(offset)
        let cursor = 0
        for (const part of parts) {
            result.set(part, cursor)
            cursor += part.length
        }
        return result
    }
}
