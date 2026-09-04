/**
 * Browser takes arrive as whatever MediaRecorder negotiated (webm/Opus on
 * Chromium/Firefox, mp4/AAC on Safari). The fixtures layout expects wav, so
 * every take is transcoded once on save — 48 kHz mono s16, matching what the
 * corpus fetchers produce. The capture codec itself is measured null for
 * accuracy (see the eval README findings log), so nothing is lost here.
 */

import { execFile } from 'child_process'
import ffmpegPath from 'ffmpeg-static'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

/**
 * `trimSec` cuts the take's head — the metronome count-in — so the saved wav's
 * t=0 is the clip's beat 0, which is what the quantizer and the truth assume.
 * The trim is an output option (after decode), so it cuts at sample accuracy.
 */
export async function transcodeToWav(input: Buffer, trimSec = 0): Promise<{ wav: Buffer; durationSec: number }> {
    if (!ffmpegPath) throw new Error('ffmpeg-static did not resolve a binary for this platform')
    const dir = mkdtempSync(join(tmpdir(), 'eval-take-'))
    try {
        const inPath = join(dir, 'take.bin')
        const outPath = join(dir, 'take.wav')
        writeFileSync(inPath, input)
        await execFileAsync(ffmpegPath, [
            '-hide_banner',
            '-loglevel',
            'error',
            '-i',
            inPath,
            ...(trimSec > 0 ? ['-ss', trimSec.toFixed(3)] : []),
            '-ac',
            '1',
            '-ar',
            '48000',
            '-c:a',
            'pcm_s16le',
            outPath,
        ])
        const wav = readFileSync(outPath)
        // 44-byte canonical header, 2 bytes/sample mono 48k.
        const durationSec = Math.max(0, wav.byteLength - 44) / 2 / 48000
        return { wav, durationSec }
    } finally {
        rmSync(dir, { recursive: true, force: true })
    }
}
