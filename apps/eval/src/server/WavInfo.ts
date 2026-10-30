import { closeSync, openSync, readSync } from 'fs'

import { FileCache } from './FileCache'

/**
 * A WAV file's duration from its RIFF header alone — the clip lists show the length of hundreds
 * of clips, and reading 64 KB per file beats decoding any of them. Non-PCM or malformed headers
 * read as unknown.
 */
export class WavInfo {
    private static readonly cache = new FileCache<number | null>((path) => WavInfo.readDuration(path))

    /** Seconds of audio, or null when the header can't be read. */
    static duration(path: string): number | null {
        return WavInfo.cache.read(path)
    }

    private static readDuration(path: string): number | null {
        const fd = openSync(path, 'r')
        try {
            const head = Buffer.alloc(65536)
            const bytes = readSync(fd, head, 0, head.length, 0)
            if (bytes < 44 || head.toString('ascii', 0, 4) !== 'RIFF' || head.toString('ascii', 8, 12) !== 'WAVE') return null
            let byteRate = 0
            let offset = 12
            while (offset + 8 <= bytes) {
                const id = head.toString('ascii', offset, offset + 4)
                const size = head.readUInt32LE(offset + 4)
                if (id === 'fmt ') byteRate = head.readUInt32LE(offset + 16)
                if (id === 'data') return byteRate > 0 ? size / byteRate : null
                offset += 8 + size + (size % 2)
            }
            return null
        } finally {
            closeSync(fd)
        }
    }
}
