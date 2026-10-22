import { expect, type Page } from '@playwright/test'

/**
 * A hermetic recording for the mocked-API suite: a synthetic microphone (an oscillator routed
 * into a MediaStream, so MediaRecorder has real audio to encode) and a stand-in for the
 * transcription gateway's WebSocket. The gateway answers a take's `end` the way the real one
 * drains: it streams `notes` back as the take's first bar, then `recording-complete`.
 *
 * Both hooks only reach documents loaded after they are installed, so this reloads the editor
 * and waits for its chrome.
 */
export async function mockRecording(page: Page, { notes = true }: { notes?: boolean } = {}): Promise<void> {
    await page.addInitScript(() => {
        Object.defineProperty(MediaDevices.prototype, 'getUserMedia', {
            configurable: true,
            value: () => {
                const context = new AudioContext()
                const oscillator = context.createOscillator()
                const destination = context.createMediaStreamDestination()
                oscillator.connect(destination)
                oscillator.start()
                return Promise.resolve(destination.stream)
            },
        })
    })
    // One whole-note G4 in the take's first bar — or a bar of rest when the take heard nothing.
    const entry = notes
        ? { _type: 'note', pitch: { step: 'G', octave: 4 }, duration: 48, voice: '1', type: 'whole' }
        : { _type: 'note', rest: {}, duration: 48, voice: '1', type: 'whole' }
    const bar = { number: '1', entries: [{ _type: 'attributes', divisions: 12 }, entry] }
    await page.routeWebSocket(/\/recording\?/, (ws) => {
        ws.onMessage((message) => {
            if (typeof message !== 'string') return
            const frame = JSON.parse(message) as { type?: string }
            if (frame.type !== 'end') return
            ws.send(JSON.stringify({ type: 'score-update', measures: { 0: bar } }))
            ws.send(JSON.stringify({ type: 'recording-complete' }))
        })
    })
    await page.reload()
    await expect(page.getByRole('button', { name: 'Export score' })).toBeVisible()
}
