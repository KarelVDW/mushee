declare module 'web-audio-api' {
    export class AudioContext {
        constructor(options?: { length?: number; numberOfChannels?: number; sampleRate?: number })
        decodeAudioData(
            audioData: ArrayBuffer,
            successCallback: (audioBuffer: AudioBuffer) => void,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            errorCallback?: (error: any) => void,
        ): void
    }

    export class AudioBuffer {
        duration: number
        sampleRate: number
        numberOfChannels: number
        length: number
        getChannelData(channel: number): Float32Array
    }
}
