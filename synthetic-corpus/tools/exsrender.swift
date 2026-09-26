// Offline renderer: plays a JSON event list through AVAudioUnitSampler loaded
// with an EXS / aupreset / sf2 instrument and writes a float WAV.
// Usage: exsrender <instrument> <events.json> <out.wav> [sampleRate]
// events.json: {"duration": sec, "events": [{"t": sec, "type": "on"|"off"|"cc"|"bend", ...}]}
import AVFoundation
import Foundation

struct Event: Decodable {
    let t: Double
    let type: String
    let note: UInt8?
    let vel: UInt8?
    let cc: UInt8?
    let value: Int?
}

struct Score: Decodable {
    let duration: Double
    let events: [Event]
}

let args = CommandLine.arguments
guard args.count >= 4 else {
    FileHandle.standardError.write("usage: exsrender <instrument> <events.json> <out.wav> [sr]\n".data(using: .utf8)!)
    exit(2)
}
let instURL = URL(fileURLWithPath: args[1])
let score = try JSONDecoder().decode(Score.self, from: Data(contentsOf: URL(fileURLWithPath: args[2])))
let outURL = URL(fileURLWithPath: args[3])
let sr = args.count > 4 ? Double(args[4])! : 44100

let engine = AVAudioEngine()
let sampler = AVAudioUnitSampler()
let format = AVAudioFormat(standardFormatWithSampleRate: sr, channels: 2)!
do { try engine.enableManualRenderingMode(.offline, format: format, maximumFrameCount: 4096) } catch { fatalError("manual mode: \(error)") }
engine.attach(sampler)
engine.connect(sampler, to: engine.mainMixerNode, format: nil)
do { try sampler.loadInstrument(at: instURL) } catch { fatalError("load: \(error)") }
do { try engine.start() } catch { fatalError("start: \(error)") }

let events = score.events.sorted { $0.t < $1.t }
let total = AVAudioFramePosition(score.duration * sr)
let buffer = AVAudioPCMBuffer(pcmFormat: engine.manualRenderingFormat, frameCapacity: 512)!
let file = try AVAudioFile(forWriting: outURL, settings: engine.manualRenderingFormat.settings, commonFormat: .pcmFormatFloat32, interleaved: false)
var pos: AVAudioFramePosition = 0
var next = 0
while pos < total {
    // Dispatch every event due before the end of this block at block start
    // (block = 64 frames => <1.5 ms jitter).
    let block = AVAudioFrameCount(min(64, total - pos))
    let blockEnd = Double(pos + AVAudioFramePosition(block)) / sr
    while next < events.count && events[next].t < blockEnd {
        let e = events[next]
        switch e.type {
        case "on": sampler.startNote(e.note!, withVelocity: e.vel ?? 100, onChannel: 0)
        case "off": sampler.stopNote(e.note!, onChannel: 0)
        case "cc": sampler.sendController(e.cc!, withValue: UInt8(e.value!), onChannel: 0)
        case "bend": sampler.sendPitchBend(UInt16(e.value!), onChannel: 0)
        default: break
        }
        next += 1
    }
    let status = try engine.renderOffline(block, to: buffer)
    guard status == .success else { break }
    try file.write(from: buffer)
    pos += AVAudioFramePosition(block)
}
engine.stop()
if #available(macOS 15.0, *) { file.close() }
